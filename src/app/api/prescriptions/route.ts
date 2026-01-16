import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getSession } from "@/lib/session-store";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
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
      pdfBase64,
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

    if (!patientName || !patientEmail || !medication || !sig) {
      status = 400;
      const res = badRequest("patientName, patientEmail, medication, and sig are required.");
      logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
      return res;
    }

    if (!pdfBase64 || typeof pdfBase64 !== "string") {
      status = 400;
      const res = badRequest("pdfBase64 is required.");
      logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
      return res;
    }

    const pdfBuffer = Buffer.from(pdfBase64, "base64");

    await query(
      `INSERT INTO prescriptions (
        session_code, patient_name, patient_email,
        physician_name, clinic_name, clinic_address,
        medication, strength, sig, quantity, refills, notes, pdf_bytes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        sessionCode,
        patientName,
        patientEmail,
        physicianName || null,
        clinicName || null,
        clinicAddress || null,
        medication,
        strength || null,
        sig,
        quantity || null,
        refills || null,
        notes || null,
        pdfBuffer,
      ],
    );

    const res = NextResponse.json({ success: true });
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
      created_at: Date;
    }>(
      `SELECT id, patient_name, patient_email, physician_name, clinic_name, clinic_address,
              medication, strength, sig, quantity, refills, notes, created_at
       FROM prescriptions
       WHERE session_code = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [sessionCode],
    );

    if (result.rows.length === 0) {
      status = 404;
      const res = badRequest("No prescription found for this session.", status);
      logRequestMeta("/api/prescriptions", requestId, status, Date.now() - started);
      return res;
    }

    const row = result.rows[0];
    const res = NextResponse.json({
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
      createdAt: row.created_at,
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

