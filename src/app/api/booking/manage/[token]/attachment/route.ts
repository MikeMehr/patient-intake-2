/**
 * POST /api/booking/manage/[token]/attachment
 * Files a patient attaches to their own booking (photo or PDF of their complaint/form).
 *
 * No login: the booking's manage token IS the credential, same as the GET route
 * beside this one. Called after the appointment is already committed, so a failure
 * here can never affect the booking itself.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { query } from "@/lib/db";
import { hashManageToken } from "@/lib/booking-token";
import { getAppointmentByToken } from "@/lib/booking-store";
import { uploadDocumentBlob } from "@/lib/azure-blob-documents";
import { consumeRateLimit } from "@/lib/invitation-security";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { sanitizeFilename, validatePatientUpload } from "@/lib/upload-validation";

export const runtime = "nodejs";

const MAX_FILES = 3;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  const { token } = await params;

  try {
    const tokenHash = hashManageToken(token);

    const rl = await consumeRateLimit(`attachment:${tokenHash}`, 20, 600);
    if (!rl.allowed) {
      logRequestMeta("/api/booking/manage/attachment", requestId, 429, Date.now() - started);
      return NextResponse.json(
        { error: "Too many attempts. Please try again in a few minutes." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
    }

    const appointment = await getAppointmentByToken(tokenHash);
    // An expired or cancelled booking is indistinguishable from an unknown token —
    // same reasoning as the GET route beside this one.
    if (
      !appointment ||
      appointment.cancelledAt ||
      new Date(appointment.manageTokenExpiresAt).getTime() <= Date.now()
    ) {
      logRequestMeta("/api/booking/manage/attachment", requestId, 404, Date.now() - started);
      return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      logRequestMeta("/api/booking/manage/attachment", requestId, 400, Date.now() - started);
      return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
    }

    const files = (formData.getAll("files") as File[]).filter((f) => f && f.size > 0);
    if (!files.length) {
      logRequestMeta("/api/booking/manage/attachment", requestId, 400, Date.now() - started);
      return NextResponse.json({ error: "Please choose at least one file." }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      logRequestMeta("/api/booking/manage/attachment", requestId, 400, Date.now() - started);
      return NextResponse.json(
        { error: `You can attach at most ${MAX_FILES} files.` },
        { status: 400 },
      );
    }

    for (const file of files) {
      const rejection = validatePatientUpload(file);
      if (rejection) {
        logRequestMeta("/api/booking/manage/attachment", requestId, 400, Date.now() - started);
        return NextResponse.json({ error: rejection }, { status: 400 });
      }
    }

    let stored = 0;
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const blobPath = `${appointment.organizationId}/appointments/${appointment.id}/${randomBytes(8).toString("hex")}-${sanitizeFilename(file.name)}`;
      await uploadDocumentBlob({
        blobName: blobPath,
        buffer,
        contentType: file.type || "application/octet-stream",
      });
      await query(
        `INSERT INTO appointment_files
           (appointment_id, blob_path, original_filename, content_type, size_bytes)
         VALUES ($1, $2, $3, $4, $5)`,
        [appointment.id, blobPath, file.name, file.type || null, file.size],
      );
      stored += 1;
    }

    logRequestMeta("/api/booking/manage/attachment", requestId, 200, Date.now() - started);
    return NextResponse.json({ success: true, count: stored });
  } catch (error) {
    console.error("[api/booking/manage/attachment POST] Error:", error);
    logRequestMeta("/api/booking/manage/attachment", requestId, 500, Date.now() - started);
    return NextResponse.json(
      { error: "Something went wrong while uploading. Please try again." },
      { status: 500 },
    );
  }
}
