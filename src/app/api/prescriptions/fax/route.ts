import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getSession } from "@/lib/session-store";
import { sendFaxViaSrfax } from "@/lib/srfax";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { query } from "@/lib/db";

function hasCompletedSafetyChecklist(input: unknown): boolean {
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

async function hasFaxStatusColumns(): Promise<boolean> {
  const result = await query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'prescriptions'
       AND column_name IN ('fax_status', 'fax_error', 'fax_sent_at')`,
  );
  return (result.rowCount ?? 0) >= 3;
}

async function hasPrescriptionStatusColumn(): Promise<boolean> {
  const result = await query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'prescriptions'
       AND column_name = 'prescription_status'`,
  );
  return (result.rowCount ?? 0) > 0;
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  let requestBody:
    | {
        sessionCode?: string;
        prescriptionId?: string;
        faxNumber?: string;
        pdfBase64?: string;
        fileName?: string;
        attestationAccepted?: boolean;
        attestationText?: string;
        attestedAt?: string;
        safetyChecklist?: unknown;
      }
    | null = null;
  try {
    const body = await request.json();
    requestBody = body;
    const {
      sessionCode,
      prescriptionId,
      faxNumber,
      pdfBase64,
      fileName,
      attestationAccepted,
      safetyChecklist,
    } = (body || {}) as {
      sessionCode?: string;
      prescriptionId?: string;
      faxNumber?: string;
      pdfBase64?: string;
      fileName?: string;
      attestationAccepted?: boolean;
      attestationText?: string;
      attestedAt?: string;
      safetyChecklist?: unknown;
    };

    if (!sessionCode || !faxNumber || !pdfBase64) {
      status = 400;
      const res = NextResponse.json(
        { error: "sessionCode, faxNumber, and pdfBase64 are required." },
        { status },
      );
      logRequestMeta("/api/prescriptions/fax", requestId, status, Date.now() - started);
      return res;
    }
    if (attestationAccepted !== true) {
      status = 400;
      const res = NextResponse.json(
        { error: "Physician attestation is required before faxing prescription." },
        { status },
      );
      logRequestMeta("/api/prescriptions/fax", requestId, status, Date.now() - started);
      return res;
    }
    if (!hasCompletedSafetyChecklist(safetyChecklist)) {
      status = 400;
      const res = NextResponse.json(
        { error: "Complete all prescription safety checks before faxing." },
        { status },
      );
      logRequestMeta("/api/prescriptions/fax", requestId, status, Date.now() - started);
      return res;
    }

    const auth = await getCurrentSession();
    if (!auth) {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required." }, { status });
      logRequestMeta("/api/prescriptions/fax", requestId, status, Date.now() - started);
      return res;
    }
    if (auth.userType !== "provider") {
      status = 403;
      const res = NextResponse.json({ error: "Only providers can fax prescriptions." }, { status });
      logRequestMeta("/api/prescriptions/fax", requestId, status, Date.now() - started);
      return res;
    }

    const patientSession = await getSession(sessionCode);
    if (!patientSession) {
      status = 404;
      const res = NextResponse.json({ error: "Session not found." }, { status });
      logRequestMeta("/api/prescriptions/fax", requestId, status, Date.now() - started);
      return res;
    }
    if (patientSession.physicianId !== auth.userId) {
      status = 403;
      const res = NextResponse.json({ error: "You do not have access to this session." }, { status });
      logRequestMeta("/api/prescriptions/fax", requestId, status, Date.now() - started);
      return res;
    }

    const canTrackFaxStatus = await hasFaxStatusColumns();
    const canTrackPrescriptionStatus = await hasPrescriptionStatusColumn();

    if (canTrackFaxStatus && prescriptionId && typeof prescriptionId === "string") {
      const sendingUpdate = canTrackPrescriptionStatus
        ? await query(
            `UPDATE prescriptions
             SET fax_status = 'sending',
                 fax_error = NULL,
                 prescription_status = 'fax_sending'
             WHERE id = $1 AND session_code = $2`,
            [prescriptionId, sessionCode],
          )
        : await query(
            `UPDATE prescriptions
             SET fax_status = 'sending', fax_error = NULL
             WHERE id = $1 AND session_code = $2`,
            [prescriptionId, sessionCode],
          );
      if ((sendingUpdate.rowCount ?? 0) === 0) {
        status = 404;
        const res = NextResponse.json({ error: "Prescription not found for this session." }, { status });
        logRequestMeta("/api/prescriptions/fax", requestId, status, Date.now() - started);
        return res;
      }
    }

    const result = await sendFaxViaSrfax({
      toFaxNumber: faxNumber,
      fileName: fileName || `prescription-${sessionCode}.pdf`,
      fileContentBase64: pdfBase64,
    });

    if (canTrackFaxStatus && prescriptionId && typeof prescriptionId === "string") {
      if (canTrackPrescriptionStatus) {
        await query(
          `UPDATE prescriptions
           SET fax_status = 'queued',
               fax_sent_at = NOW(),
               fax_error = NULL,
               prescription_status = 'fax_queued'
           WHERE id = $1 AND session_code = $2`,
          [prescriptionId, sessionCode],
        );
      } else {
        await query(
          `UPDATE prescriptions
           SET fax_status = 'queued',
               fax_sent_at = NOW(),
               fax_error = NULL
           WHERE id = $1 AND session_code = $2`,
          [prescriptionId, sessionCode],
        );
      }
    }

    const res = NextResponse.json({
      success: true,
      result,
      faxStatus: canTrackFaxStatus ? "queued" : null,
      prescriptionStatus:
        canTrackFaxStatus && canTrackPrescriptionStatus ? "fax_queued" : null,
    });
    logRequestMeta("/api/prescriptions/fax", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[prescriptions/fax] POST failed:", error);
    try {
      const sessionCode = typeof requestBody?.sessionCode === "string" ? requestBody.sessionCode : "";
      const prescriptionId =
        typeof requestBody?.prescriptionId === "string" ? requestBody.prescriptionId : "";
      const canTrackFaxStatus = await hasFaxStatusColumns();
      const canTrackPrescriptionStatus = await hasPrescriptionStatusColumn();
      if (sessionCode && prescriptionId && canTrackFaxStatus) {
        await query(
          `UPDATE prescriptions
           SET fax_status = 'failed',
               fax_error = $3
               ${
                 canTrackPrescriptionStatus
                   ? ", prescription_status = 'fax_failed'"
                   : ""
               }
           WHERE id = $1 AND session_code = $2`,
          [
            prescriptionId,
            sessionCode,
            error instanceof Error ? error.message.slice(0, 1000) : "Failed to fax prescription.",
          ],
        );
      }
    } catch {
      // ignore status update failures
    }
    const res = NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fax prescription." },
      { status },
    );
    logRequestMeta("/api/prescriptions/fax", requestId, status, Date.now() - started);
    return res;
  }
}

