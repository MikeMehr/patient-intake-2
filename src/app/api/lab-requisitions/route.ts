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
      labs,
      instructions,
      pdfBase64,
    } = body ?? {};

    if (!sessionCode || typeof sessionCode !== "string") {
      status = 400;
      const res = badRequest("sessionCode is required.");
      logRequestMeta("/api/lab-requisitions", requestId, status, Date.now() - started);
      return res;
    }

    const session = await getCurrentSession();
    if (!session) {
      status = 401;
      const res = badRequest("Authentication required.", status);
      logRequestMeta("/api/lab-requisitions", requestId, status, Date.now() - started);
      return res;
    }
    if (session.userType !== "provider") {
      status = 403;
      const res = badRequest("Only providers can save lab requisitions.", status);
      logRequestMeta("/api/lab-requisitions", requestId, status, Date.now() - started);
      return res;
    }

    const patientSession = await getSession(sessionCode);
    if (!patientSession) {
      status = 404;
      const res = badRequest("Session not found.", status);
      logRequestMeta("/api/lab-requisitions", requestId, status, Date.now() - started);
      return res;
    }
    if (patientSession.physicianId !== session.userId) {
      status = 403;
      const res = badRequest("You do not have access to this session.", status);
      logRequestMeta("/api/lab-requisitions", requestId, status, Date.now() - started);
      return res;
    }

    if (!patientName || !patientEmail) {
      status = 400;
      const res = badRequest("patientName and patientEmail are required.");
      logRequestMeta("/api/lab-requisitions", requestId, status, Date.now() - started);
      return res;
    }

    if (!Array.isArray(labs) || labs.length === 0) {
      status = 400;
      const res = badRequest("labs must be a non-empty array.");
      logRequestMeta("/api/lab-requisitions", requestId, status, Date.now() - started);
      return res;
    }

    if (!pdfBase64 || typeof pdfBase64 !== "string") {
      status = 400;
      const res = badRequest("pdfBase64 is required.");
      logRequestMeta("/api/lab-requisitions", requestId, status, Date.now() - started);
      return res;
    }

    const pdfBuffer = Buffer.from(pdfBase64, "base64");

    await query(
      `INSERT INTO lab_requisitions (
        session_code, patient_name, patient_email,
        physician_name, clinic_name, clinic_address,
        labs, additional_instructions, pdf_bytes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        sessionCode,
        patientName,
        patientEmail,
        physicianName || null,
        clinicName || null,
        clinicAddress || null,
        JSON.stringify(labs),
        instructions || null,
        pdfBuffer,
      ],
    );

    const res = NextResponse.json({ success: true });
    logRequestMeta("/api/lab-requisitions", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[lab-requisitions] POST failed:", error);
    const res = NextResponse.json({ error: "Failed to save lab requisition." }, { status });
    logRequestMeta("/api/lab-requisitions", requestId, status, Date.now() - started);
    return res;
  }
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  const { searchParams } = new URL(request.url);
  const sessionCode = searchParams.get("code");
  const id = searchParams.get("id");

  if (!sessionCode) {
    status = 400;
    const res = badRequest("code (sessionCode) is required.");
    logRequestMeta("/api/lab-requisitions", requestId, status, Date.now() - started);
    return res;
  }

  try {
    const session = await getCurrentSession();
    if (!session) {
      status = 401;
      const res = badRequest("Authentication required.", status);
      logRequestMeta("/api/lab-requisitions", requestId, status, Date.now() - started);
      return res;
    }
    if (session.userType !== "provider") {
      status = 403;
      const res = badRequest("Only providers can view lab requisitions.", status);
      logRequestMeta("/api/lab-requisitions", requestId, status, Date.now() - started);
      return res;
    }

    const patientSession = await getSession(sessionCode);
    if (!patientSession) {
      status = 404;
      const res = badRequest("Session not found.", status);
      logRequestMeta("/api/lab-requisitions", requestId, status, Date.now() - started);
      return res;
    }
    if (patientSession.physicianId !== session.userId) {
      status = 403;
      const res = badRequest("You do not have access to this session.", status);
      logRequestMeta("/api/lab-requisitions", requestId, status, Date.now() - started);
      return res;
    }

    if (id) {
      // Return a single requisition (metadata + pdf)
      const result = await query<{
        id: string;
        patient_name: string;
        patient_email: string;
        physician_name: string | null;
        clinic_name: string | null;
        clinic_address: string | null;
        labs: any;
        additional_instructions: string | null;
        pdf_bytes: Buffer;
        created_at: Date;
      }>(
        `SELECT id, patient_name, patient_email, physician_name, clinic_name, clinic_address,
                labs, additional_instructions, pdf_bytes, created_at
         FROM lab_requisitions
         WHERE session_code = $1 AND id = $2
         LIMIT 1`,
        [sessionCode, id],
      );

      if (result.rows.length === 0) {
        status = 404;
        const res = badRequest("Lab requisition not found for this session.", status);
        logRequestMeta("/api/lab-requisitions", requestId, status, Date.now() - started);
        return res;
      }

      const row = result.rows[0];
      if (row.pdf_bytes) {
        const res = new NextResponse(row.pdf_bytes, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="lab-requisition-${row.id}.pdf"`,
          },
        });
        logRequestMeta("/api/lab-requisitions", requestId, status, Date.now() - started);
        return res;
      }
      const res = NextResponse.json({
        id: row.id,
        patientName: row.patient_name,
        patientEmail: row.patient_email,
        physicianName: row.physician_name,
        clinicName: row.clinic_name,
        clinicAddress: row.clinic_address,
        labs: row.labs,
        instructions: row.additional_instructions,
        createdAt: row.created_at,
        pdfBase64: null,
      });
      logRequestMeta("/api/lab-requisitions", requestId, status, Date.now() - started);
      return res;
    } else {
      // Return list of requisitions metadata
      const result = await query<{
        id: string;
        patient_name: string;
        patient_email: string;
        physician_name: string | null;
        clinic_name: string | null;
        clinic_address: string | null;
        labs: any;
        additional_instructions: string | null;
        created_at: Date;
      }>(
        `SELECT id, patient_name, patient_email, physician_name, clinic_name, clinic_address, labs, additional_instructions, created_at
         FROM lab_requisitions
         WHERE session_code = $1
         ORDER BY created_at DESC`,
        [sessionCode],
      );

      const res = NextResponse.json({
        requisitions: result.rows.map((row) => ({
          id: row.id,
          patientName: row.patient_name,
          patientEmail: row.patient_email,
          physicianName: row.physician_name,
          clinicName: row.clinic_name,
          clinicAddress: row.clinic_address,
          labs: row.labs,
          instructions: row.additional_instructions,
          createdAt: row.created_at,
        })),
      });
      logRequestMeta("/api/lab-requisitions", requestId, status, Date.now() - started);
      return res;
    }
  } catch (error) {
    status = 500;
    console.error("[lab-requisitions] GET failed:", error);
    const res = NextResponse.json({ error: "Failed to fetch lab requisition." }, { status });
    logRequestMeta("/api/lab-requisitions", requestId, status, Date.now() - started);
    return res;
  }
}

