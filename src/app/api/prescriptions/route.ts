import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getCurrentSession } from "@/lib/auth";
import { getSession } from "@/lib/session-store";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type PrescriptionMedicationRow = {
  medication: string;
  strength?: string | null;
  sig: string;
  quantity?: string | null;
  refills?: string | null;
  notes?: string | null;
};

type PrescriptionSafetyChecklist = {
  allergiesReviewed: boolean;
  interactionsReviewed: boolean;
  renalRiskReviewed: boolean;
  giRiskReviewed: boolean;
  anticoagulantReviewed: boolean;
  pregnancyReviewed: boolean;
};

function hasCompletedSafetyChecklist(input: unknown): input is PrescriptionSafetyChecklist {
  if (!input || typeof input !== "object") return false;
  const candidate = input as Record<string, unknown>;
  return (
    candidate.allergiesReviewed === true &&
    candidate.interactionsReviewed === true &&
    candidate.renalRiskReviewed === true &&
    candidate.giRiskReviewed === true &&
    candidate.anticoagulantReviewed === true &&
    candidate.pregnancyReviewed === true
  );
}

function normalizeMedications(input: unknown): PrescriptionMedicationRow[] {
  if (!Array.isArray(input)) return [];
  const normalized: PrescriptionMedicationRow[] = [];
  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const candidate = row as Record<string, unknown>;
    const medication = typeof candidate.medication === "string" ? candidate.medication.trim() : "";
    const sig = typeof candidate.sig === "string" ? candidate.sig.trim() : "";
    const strength = typeof candidate.strength === "string" ? candidate.strength.trim() : "";
    const quantity = typeof candidate.quantity === "string" ? candidate.quantity.trim() : "";
    const refills = typeof candidate.refills === "string" ? candidate.refills.trim() : "";
    const notes = typeof candidate.notes === "string" ? candidate.notes.trim() : "";
    if (!medication || !sig) continue;
    normalized.push({
      medication,
      sig,
      strength: strength || null,
      quantity: quantity || null,
      refills: refills || null,
      notes: notes || null,
    });
  }
  return normalized;
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const body = await request.json();
    const {
      sessionCode,
      patientName,
      patientEmail,
      physicianName,
      clinicName,
      clinicAddress,
      medication,
      strength,
      sig,
      quantity,
      refills,
      notes,
      medications,
      pdfBase64,
      attestationAccepted,
      safetyChecklist,
      attestationText,
      attestedAt,
    } = body ?? {};

    if (!sessionCode || typeof sessionCode !== "string") {
      status = 400;
      const res = badRequest("sessionCode is required.");
      logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
      return res;
    }

    const session = await getCurrentSession();
    if (!session) {
      status = 401;
      const res = badRequest("Authentication required.", status);
      logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
      return res;
    }
    if (session.userType !== "provider") {
      status = 403;
      const res = badRequest("Only providers can save prescriptions.", status);
      logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
      return res;
    }

    const patientSession = await getSession(sessionCode);
    if (!patientSession) {
      status = 404;
      const res = badRequest("Session not found.", status);
      logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
      return res;
    }
    if (patientSession.physicianId !== session.userId) {
      status = 403;
      const res = badRequest("You do not have access to this session.", status);
      logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
      return res;
    }

    const normalizedMedications = normalizeMedications(medications);
    const legacyMedication =
      typeof medication === "string" && medication.trim().length > 0 ? medication.trim() : "";
    const legacySig = typeof sig === "string" && sig.trim().length > 0 ? sig.trim() : "";
    const fallbackMedication =
      legacyMedication && legacySig
        ? [
            {
              medication: legacyMedication,
              sig: legacySig,
              strength: typeof strength === "string" && strength.trim() ? strength.trim() : null,
              quantity: typeof quantity === "string" && quantity.trim() ? quantity.trim() : null,
              refills: typeof refills === "string" && refills.trim() ? refills.trim() : null,
              notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
            } satisfies PrescriptionMedicationRow,
          ]
        : [];
    const medsToPersist = normalizedMedications.length > 0 ? normalizedMedications : fallbackMedication;

    if (!patientName || !patientEmail || medsToPersist.length === 0) {
      status = 400;
      const res = badRequest("patientName, patientEmail, and at least one medication with sig are required.");
      logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
      return res;
    }

    if (!pdfBase64 || typeof pdfBase64 !== "string") {
      status = 400;
      const res = badRequest("pdfBase64 is required.");
      logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
      return res;
    }
    if (attestationAccepted !== true) {
      status = 400;
      const res = badRequest("Physician attestation is required before saving prescription.");
      logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
      return res;
    }
    if (!hasCompletedSafetyChecklist(safetyChecklist)) {
      status = 400;
      const res = badRequest("Complete all prescription safety checks before saving.");
      logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
      return res;
    }

    if (medsToPersist.length > 20) {
      status = 400;
      const res = badRequest("A maximum of 20 medications is allowed.");
      logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
      return res;
    }

    const pdfBuffer = Buffer.from(pdfBase64, "base64");
    const firstMedication = medsToPersist[0];

    const columnsResult = await query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'prescriptions'
         AND column_name IN (
           'medications',
           'prescription_status',
           'attestation_text',
           'attested_at',
           'authorized_by',
           'authorized_at',
           'content_hash'
         )`,
    );
    const columnNames = new Set(columnsResult.rows.map((row) => row.column_name));
    const hasMedicationsColumn = columnNames.has("medications");

    const insertResult = hasMedicationsColumn
      ? await query<{ id: string }>(
          `INSERT INTO prescriptions (
            session_code, patient_name, patient_email,
            physician_name, clinic_name, clinic_address,
            medication, strength, sig, quantity, refills, notes, medications, pdf_bytes
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          RETURNING id`,
          [
            sessionCode,
            patientName,
            patientEmail,
            physicianName || null,
            clinicName || null,
            clinicAddress || null,
            firstMedication.medication,
            firstMedication.strength || null,
            firstMedication.sig,
            firstMedication.quantity || null,
            firstMedication.refills || null,
            firstMedication.notes || null,
            JSON.stringify(medsToPersist),
            pdfBuffer,
          ],
        )
      : await query<{ id: string }>(
          `INSERT INTO prescriptions (
            session_code, patient_name, patient_email,
            physician_name, clinic_name, clinic_address,
            medication, strength, sig, quantity, refills, notes, pdf_bytes
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          RETURNING id`,
          [
            sessionCode,
            patientName,
            patientEmail,
            physicianName || null,
            clinicName || null,
            clinicAddress || null,
            firstMedication.medication,
            firstMedication.strength || null,
            firstMedication.sig,
            firstMedication.quantity || null,
            firstMedication.refills || null,
            firstMedication.notes || null,
            pdfBuffer,
          ],
        );

    const insertedId = insertResult.rows[0]?.id ?? null;
    if (insertedId) {
      const setClauses: string[] = [];
      const params: Array<string | Date | null> = [insertedId];
      let paramIndex = 2;
      const parsedAttestedAt =
        typeof attestedAt === "string" && attestedAt.trim().length > 0 ? new Date(attestedAt) : null;
      const normalizedAttestedAt =
        parsedAttestedAt && !Number.isNaN(parsedAttestedAt.getTime())
          ? parsedAttestedAt
          : new Date();
      const safeAttestationText =
        typeof attestationText === "string" && attestationText.trim().length > 0
          ? attestationText.trim().slice(0, 2000)
          : null;
      const contentHash = createHash("sha256").update(pdfBuffer).digest("hex");

      if (columnNames.has("prescription_status")) {
        setClauses.push(`prescription_status = $${paramIndex++}`);
        params.push("authorized");
      }
      if (columnNames.has("attestation_text")) {
        setClauses.push(`attestation_text = $${paramIndex++}`);
        params.push(safeAttestationText);
      }
      if (columnNames.has("attested_at")) {
        setClauses.push(`attested_at = $${paramIndex++}`);
        params.push(normalizedAttestedAt);
      }
      if (columnNames.has("authorized_by")) {
        setClauses.push(`authorized_by = $${paramIndex++}`);
        params.push(session.userId);
      }
      if (columnNames.has("authorized_at")) {
        setClauses.push(`authorized_at = $${paramIndex++}`);
        params.push(normalizedAttestedAt);
      }
      if (columnNames.has("content_hash")) {
        setClauses.push(`content_hash = $${paramIndex++}`);
        params.push(contentHash);
      }
      if (setClauses.length > 0) {
        await query(
          `UPDATE prescriptions
           SET ${setClauses.join(", ")}
           WHERE id = $1`,
          params,
        );
      }
    }

    const res = NextResponse.json({ success: true, id: insertedId });
    logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[prescriptions] POST failed:", error);
    const res = NextResponse.json({ error: "Failed to save prescription." }, { status });
    logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
    return res;
  }
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  const { searchParams } = new URL(request.url);
  const sessionCode = searchParams.get("code");

  if (!sessionCode) {
    status = 400;
    const res = badRequest("code (sessionCode) is required.");
    logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
    return res;
  }

  try {
    const session = await getCurrentSession();
    if (!session) {
      status = 401;
      const res = badRequest("Authentication required.", status);
      logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
      return res;
    }
    if (session.userType !== "provider") {
      status = 403;
      const res = badRequest("Only providers can view prescriptions.", status);
      logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
      return res;
    }

    const patientSession = await getSession(sessionCode);
    if (!patientSession) {
      status = 404;
      const res = badRequest("Session not found.", status);
      logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
      return res;
    }
    if (patientSession.physicianId !== session.userId) {
      status = 403;
      const res = badRequest("You do not have access to this session.", status);
      logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
      return res;
    }

    const columnsResult = await query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'prescriptions'
         AND column_name IN (
           'medications',
           'fax_status',
           'fax_error',
           'fax_sent_at',
           'prescription_status',
           'attestation_text',
           'attested_at',
           'authorized_by',
           'authorized_at',
           'content_hash'
         )`,
    );
    const columnNames = new Set(columnsResult.rows.map((row) => row.column_name));
    const hasMedicationsColumn = columnNames.has("medications");
    const hasFaxColumns =
      columnNames.has("fax_status") &&
      columnNames.has("fax_error") &&
      columnNames.has("fax_sent_at");
    const selectMedicationsColumn = hasMedicationsColumn
      ? "medications"
      : "NULL::jsonb AS medications";
    const selectStatusColumns = columnNames.has("prescription_status")
      ? "prescription_status"
      : "NULL::text AS prescription_status";
    const selectAttestationColumns = columnNames.has("attestation_text")
      ? "attestation_text"
      : "NULL::text AS attestation_text";
    const selectAttestedAtColumn = columnNames.has("attested_at")
      ? "attested_at"
      : "NULL::timestamptz AS attested_at";
    const selectAuthorizedByColumn = columnNames.has("authorized_by")
      ? "authorized_by"
      : "NULL::text AS authorized_by";
    const selectAuthorizedAtColumn = columnNames.has("authorized_at")
      ? "authorized_at"
      : "NULL::timestamptz AS authorized_at";
    const selectContentHashColumn = columnNames.has("content_hash")
      ? "content_hash"
      : "NULL::text AS content_hash";
    const selectFaxColumns = hasFaxColumns
      ? "fax_status, fax_error, fax_sent_at"
      : "NULL::text AS fax_status, NULL::text AS fax_error, NULL::timestamptz AS fax_sent_at";

    const result = await query<{
      id: string;
      patient_name: string;
      patient_email: string;
      physician_name: string | null;
      clinic_name: string | null;
      clinic_address: string | null;
      medication: string;
      strength: string | null;
      sig: string;
      quantity: string | null;
      refills: string | null;
      notes: string | null;
      medications: unknown;
      fax_status: string | null;
      fax_error: string | null;
      fax_sent_at: Date | null;
      prescription_status: string | null;
      attestation_text: string | null;
      attested_at: Date | null;
      authorized_by: string | null;
      authorized_at: Date | null;
      content_hash: string | null;
      created_at: Date;
    }>(
      `SELECT id, patient_name, patient_email, physician_name, clinic_name, clinic_address,
              medication, strength, sig, quantity, refills, notes, ${selectMedicationsColumn},
              ${selectFaxColumns}, ${selectStatusColumns}, ${selectAttestationColumns},
              ${selectAttestedAtColumn}, ${selectAuthorizedByColumn}, ${selectAuthorizedAtColumn},
              ${selectContentHashColumn}, created_at
       FROM prescriptions
       WHERE session_code = $1
       ORDER BY created_at DESC`,
      [sessionCode],
    );

    if (result.rows.length === 0) {
      status = 404;
      const res = badRequest("No prescription found for this session.", status);
      logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
      return res;
    }

    const rows = result.rows.map((row) => {
      const normalizedMedications = normalizeMedications(row.medications);
      const medicationsToReturn =
        normalizedMedications.length > 0
          ? normalizedMedications
          : [
              {
                medication: row.medication,
                sig: row.sig,
                strength: row.strength,
                quantity: row.quantity,
                refills: row.refills,
                notes: row.notes,
              },
            ];
      return {
        id: row.id,
        patientName: row.patient_name,
        patientEmail: row.patient_email,
        physicianName: row.physician_name,
        clinicName: row.clinic_name,
        clinicAddress: row.clinic_address,
        medication: row.medication,
        strength: row.strength,
        sig: row.sig,
        quantity: row.quantity,
        refills: row.refills,
        notes: row.notes,
        medications: medicationsToReturn,
        faxStatus: row.fax_status || "not_sent",
        faxError: row.fax_error,
        faxSentAt: row.fax_sent_at,
        prescriptionStatus: row.prescription_status || "draft",
        attestationText: row.attestation_text,
        attestedAt: row.attested_at,
        authorizedBy: row.authorized_by,
        authorizedAt: row.authorized_at,
        contentHash: row.content_hash,
        createdAt: row.created_at,
      };
    });

    // Keep backward compatibility with existing client code that expects
    // top-level fields for the latest prescription.
    const latest = rows[0];
    const res = NextResponse.json({
      ...latest,
      prescriptions: rows,
    });
    logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[prescriptions] GET failed:", error);
    const res = NextResponse.json({ error: "Failed to fetch prescription." }, { status });
    logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
    return res;
  }
}

