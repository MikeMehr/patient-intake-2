/**
 * POST /api/physician/transcription/phone-capture
 * Mint a short-lived phone-capture session for the signed-in provider.
 * The returned raw token goes into a QR code; the phone hits the public
 * /api/capture/[token] endpoint, and the desktop polls
 * /api/physician/transcription/phone-capture/[token] to claim the photo.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { generatePhoneCaptureToken, PHONE_CAPTURE_TTL_MINUTES } from "@/lib/phone-capture";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();

  const session = await getCurrentSession();
  if (!session) {
    logRequestMeta("/api/physician/transcription/phone-capture", requestId, 401, Date.now() - started);
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (session.userType !== "provider") {
    logRequestMeta("/api/physician/transcription/phone-capture", requestId, 403, Date.now() - started);
    return NextResponse.json({ error: "Only providers can use phone capture" }, { status: 403 });
  }

  try {
    // Opportunistic cleanup so abandoned sessions don't accumulate.
    await query(`DELETE FROM phone_capture_sessions WHERE expires_at < NOW()`);

    const { raw, hash, expiresAt } = generatePhoneCaptureToken();
    await query(
      `INSERT INTO phone_capture_sessions (token_hash, created_by, expires_at)
       VALUES ($1, $2, $3)`,
      [hash, session.userId, expiresAt],
    );

    logRequestMeta("/api/physician/transcription/phone-capture", requestId, 200, Date.now() - started);
    return NextResponse.json({
      token: raw,
      expiresAt: expiresAt.toISOString(),
      ttlMinutes: PHONE_CAPTURE_TTL_MINUTES,
    });
  } catch (error) {
    console.error("[phone-capture create] Error:", error);
    logRequestMeta("/api/physician/transcription/phone-capture", requestId, 500, Date.now() - started);
    return NextResponse.json({ error: "Could not create a capture session." }, { status: 500 });
  }
}
