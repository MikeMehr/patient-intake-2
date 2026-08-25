/**
 * Public (token-authenticated) phone photo capture.
 *   GET  /api/capture/[token]  → validity check for the phone page
 *   POST /api/capture/[token]  → accept one photo (multipart), store for desktop pickup
 *
 * No login: the unguessable single-use token IS the credential (same posture as
 * /api/uploads). Retaking overwrites the pending photo until the desktop claims
 * it, at which point the row is gone and the token is dead.
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { consumeRateLimit } from "@/lib/invitation-security";
import {
  hashPhoneCaptureToken,
  isValidPhoneCaptureTokenFormat,
  PHONE_CAPTURE_ALLOWED_MIME_TYPES,
  PHONE_CAPTURE_MAX_BYTES,
} from "@/lib/phone-capture";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

interface SessionRow {
  id: string;
  photo_mime: string | null;
  expires_at: string;
}

async function loadSession(rawToken: string): Promise<SessionRow | null> {
  const result = await query<SessionRow>(
    `SELECT id, photo_mime, expires_at
     FROM phone_capture_sessions
     WHERE token_hash = $1`,
    [hashPhoneCaptureToken(rawToken)],
  );
  return result.rows[0] ?? null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  const { token } = await params;

  try {
    if (!isValidPhoneCaptureTokenFormat(token)) {
      logRequestMeta("/api/capture", requestId, 404, Date.now() - started);
      return NextResponse.json({ valid: false, reason: "not_found" }, { status: 404 });
    }
    const row = await loadSession(token);
    if (!row) {
      logRequestMeta("/api/capture", requestId, 404, Date.now() - started);
      return NextResponse.json({ valid: false, reason: "not_found" }, { status: 404 });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      logRequestMeta("/api/capture", requestId, 200, Date.now() - started);
      return NextResponse.json({ valid: false, reason: "expired" });
    }
    logRequestMeta("/api/capture", requestId, 200, Date.now() - started);
    return NextResponse.json({ valid: true, hasPhoto: Boolean(row.photo_mime) });
  } catch (error) {
    console.error("[api/capture GET] Error:", error);
    logRequestMeta("/api/capture", requestId, 500, Date.now() - started);
    return NextResponse.json({ valid: false, reason: "error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  const { token } = await params;

  try {
    if (!isValidPhoneCaptureTokenFormat(token)) {
      logRequestMeta("/api/capture", requestId, 404, Date.now() - started);
      return NextResponse.json({ error: "This capture link is not valid." }, { status: 404 });
    }

    const rl = await consumeRateLimit(`phone-capture:${hashPhoneCaptureToken(token)}`, 15, 600);
    if (!rl.allowed) {
      logRequestMeta("/api/capture", requestId, 429, Date.now() - started);
      return NextResponse.json(
        { error: "Too many attempts. Please try again in a few minutes." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
    }

    const row = await loadSession(token);
    if (!row) {
      logRequestMeta("/api/capture", requestId, 404, Date.now() - started);
      return NextResponse.json(
        { error: "This code has already been used or is not valid. Generate a new one on your computer." },
        { status: 404 },
      );
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      logRequestMeta("/api/capture", requestId, 410, Date.now() - started);
      return NextResponse.json(
        { error: "This code has expired. Generate a new one on your computer." },
        { status: 410 },
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      logRequestMeta("/api/capture", requestId, 400, Date.now() - started);
      return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
    }

    const file = formData.get("photo");
    if (!(file instanceof File) || file.size === 0) {
      logRequestMeta("/api/capture", requestId, 400, Date.now() - started);
      return NextResponse.json({ error: "Please choose a photo." }, { status: 400 });
    }
    if (file.size > PHONE_CAPTURE_MAX_BYTES) {
      logRequestMeta("/api/capture", requestId, 400, Date.now() - started);
      return NextResponse.json({ error: "Photo is too large (max 20 MB)." }, { status: 400 });
    }
    const mime = (file.type || "").toLowerCase();
    if (!PHONE_CAPTURE_ALLOWED_MIME_TYPES.has(mime)) {
      logRequestMeta("/api/capture", requestId, 400, Date.now() - started);
      return NextResponse.json(
        { error: "Unsupported image type. Use PNG, JPEG, WEBP, or HEIC." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    await query(
      `UPDATE phone_capture_sessions SET photo = $1, photo_mime = $2 WHERE id = $3`,
      [buffer, mime, row.id],
    );

    logRequestMeta("/api/capture", requestId, 200, Date.now() - started);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/capture POST] Error:", error);
    logRequestMeta("/api/capture", requestId, 500, Date.now() - started);
    return NextResponse.json(
      { error: "Something went wrong while sending the photo. Please try again." },
      { status: 500 },
    );
  }
}
