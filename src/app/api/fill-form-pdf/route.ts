/**
 * GET /api/fill-form-pdf?code={sessionCode}
 * Returns the original uploaded form PDF with patient interview answers filled in.
 * Requires an authenticated physician session with access to the given session.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getSession } from "@/lib/session-store";
import { canAccessSessionInScope, loadSessionAccessScope } from "@/lib/session-access";
import { query } from "@/lib/db";
import { buildFilledFormPdf, sanitiseFilename } from "@/lib/fill-form-pdf";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  // Require authenticated physician session
  const authSession = await getCurrentSession();
  if (!authSession) {
    status = 401;
    const res = NextResponse.json({ error: "Authentication required" }, { status });
    logRequestMeta("/api/fill-form-pdf", requestId, status, Date.now() - started);
    return res;
  }
  if ((authSession as { userType?: string }).userType !== "provider") {
    status = 403;
    const res = NextResponse.json({ error: "Only providers can download filled forms" }, { status });
    logRequestMeta("/api/fill-form-pdf", requestId, status, Date.now() - started);
    return res;
  }

  const sessionCode = request.nextUrl.searchParams.get("code")?.trim() || null;
  if (!sessionCode) {
    status = 400;
    const res = NextResponse.json({ error: "code (session code) is required" }, { status });
    logRequestMeta("/api/fill-form-pdf", requestId, status, Date.now() - started);
    return res;
  }

  // Verify physician can access this session
  const scope = await loadSessionAccessScope(sessionCode);
  if (!scope) {
    status = 404;
    const res = NextResponse.json({ error: "Session not found" }, { status });
    logRequestMeta("/api/fill-form-pdf", requestId, status, Date.now() - started);
    return res;
  }
  if (!canAccessSessionInScope({ viewer: authSession, resource: scope })) {
    status = 403;
    const res = NextResponse.json({ error: "Access denied" }, { status });
    logRequestMeta("/api/fill-form-pdf", requestId, status, Date.now() - started);
    return res;
  }

  const session = await getSession(sessionCode);
  if (!session) {
    status = 404;
    const res = NextResponse.json({ error: "Session not found" }, { status });
    logRequestMeta("/api/fill-form-pdf", requestId, status, Date.now() - started);
    return res;
  }

  // Ensure form answers have been generated
  const formAnswers = (session.history as any)?.formAnswers as
    | { question: string; answer: string }[]
    | undefined;
  if (!Array.isArray(formAnswers) || formAnswers.length === 0) {
    status = 400;
    const res = NextResponse.json(
      { error: "Form answers not yet generated. Please generate form answers first." },
      { status },
    );
    logRequestMeta("/api/fill-form-pdf", requestId, status, Date.now() - started);
    return res;
  }

  // Fetch the stored PDF bytes from the invitation linked to this patient session.
  // JOIN on physician_id + patient_email since patient_sessions has no invitation_id FK.
  const pdfResult = await query<{
    form_pdf_data: Buffer | null;
    form_pdf_filename: string | null;
  }>(
    `SELECT pi.form_pdf_data, pi.form_pdf_filename
     FROM patient_sessions ps
     JOIN patient_invitations pi
       ON pi.physician_id = ps.physician_id
       AND LOWER(pi.patient_email) = LOWER(ps.patient_email)
     WHERE ps.session_code = $1
       AND pi.form_pdf_data IS NOT NULL
       AND pi.form_pdf_deleted_at IS NULL
     ORDER BY pi.sent_at DESC NULLS LAST
     LIMIT 1`,
    [sessionCode],
  );

  if (pdfResult.rows.length === 0 || !pdfResult.rows[0].form_pdf_data) {
    status = 404;
    const res = NextResponse.json(
      {
        error:
          "The original form PDF is no longer available (it may have expired). " +
          "The text download is still available.",
      },
      { status },
    );
    logRequestMeta("/api/fill-form-pdf", requestId, status, Date.now() - started);
    return res;
  }

  const { form_pdf_data, form_pdf_filename } = pdfResult.rows[0];

  try {
    const filledBytes = await buildFilledFormPdf({
      pdfBytes: form_pdf_data!,
      formAnswers,
      metadata: {
        patientName: session.patientName || "Patient",
        sessionDate: session.completedAt ? new Date(session.completedAt) : new Date(),
        originalFilename: form_pdf_filename,
      },
    });

    const baseName = form_pdf_filename
      ? `filled-${sanitiseFilename(form_pdf_filename)}`
      : `filled-form-${(session.patientName || "patient").replace(/\s+/g, "-").toLowerCase()}.pdf`;

    status = 200;
    logRequestMeta("/api/fill-form-pdf", requestId, status, Date.now() - started);
    return new Response(Buffer.from(filledBytes), {
      status,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${baseName}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[fill-form-pdf] Failed to build filled PDF", err);
    status = 500;
    const res = NextResponse.json({ error: "Failed to generate filled PDF." }, { status });
    logRequestMeta("/api/fill-form-pdf", requestId, status, Date.now() - started);
    return res;
  }
}
