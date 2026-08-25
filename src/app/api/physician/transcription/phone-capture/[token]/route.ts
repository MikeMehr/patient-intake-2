/**
 * Desktop side of a phone-capture session (provider auth required).
 *   GET    → poll for the photo; claiming it deletes the row.
 *   DELETE → cancel the session (user closed the QR panel).
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { hashPhoneCaptureToken, isValidPhoneCaptureTokenFormat } from "@/lib/phone-capture";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const session = await getCurrentSession();
  if (!session || session.userType !== "provider") {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!isValidPhoneCaptureTokenFormat(token)) {
    return NextResponse.json({ error: "Invalid token." }, { status: 400 });
  }

  try {
    const result = await query<{
      id: string;
      created_by: string;
      photo: Buffer | null;
      photo_mime: string | null;
      expires_at: string;
    }>(
      `SELECT id, created_by, photo, photo_mime, expires_at
       FROM phone_capture_sessions
       WHERE token_hash = $1`,
      [hashPhoneCaptureToken(token)],
    );
    const row = result.rows[0];
    if (!row || row.created_by !== session.userId) {
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await query(`DELETE FROM phone_capture_sessions WHERE id = $1`, [row.id]);
      return NextResponse.json({ status: "expired" });
    }
    if (!row.photo) {
      return NextResponse.json({ status: "waiting" });
    }

    // Claim: hand over the photo and delete the row so the token dies with it.
    await query(`DELETE FROM phone_capture_sessions WHERE id = $1`, [row.id]);
    return NextResponse.json({
      status: "ready",
      photoBase64: row.photo.toString("base64"),
      mimeType: row.photo_mime || "image/jpeg",
    });
  } catch (error) {
    console.error("[phone-capture poll] Error:", error);
    return NextResponse.json({ error: "Could not check the capture session." }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const session = await getCurrentSession();
  if (!session || session.userType !== "provider") {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!isValidPhoneCaptureTokenFormat(token)) {
    return NextResponse.json({ error: "Invalid token." }, { status: 400 });
  }

  try {
    await query(
      `DELETE FROM phone_capture_sessions WHERE token_hash = $1 AND created_by = $2`,
      [hashPhoneCaptureToken(token), session.userId],
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[phone-capture cancel] Error:", error);
    return NextResponse.json({ error: "Could not cancel the capture session." }, { status: 500 });
  }
}
