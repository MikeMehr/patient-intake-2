/**
 * POST /api/auth/reset-password
 * Request password reset (sends email with reset token)
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { randomBytes } from "crypto";
import { logDebug } from "@/lib/secure-logger";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

const RESET_TOKEN_EXPIRY_HOURS = 24;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      status = 400;
      const res = NextResponse.json(
        { error: "Email is required" },
        { status }
      );
      logRequestMeta("/api/auth/reset-password", requestId, status, Date.now() - started);
      return res;
    }

    // Find physician by email
    const result = await query<{ id: string; email: string }>(
      `SELECT id, email FROM physicians WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      // Don't reveal if email exists (security best practice)
      const res = NextResponse.json({
        success: true,
        message: "If an account exists with this email, a password reset link has been sent.",
      });
      logRequestMeta("/api/auth/reset-password", requestId, status, Date.now() - started);
      return res;
    }

    const physician = result.rows[0];

    // Generate reset token
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + RESET_TOKEN_EXPIRY_HOURS);

    // Store reset token
    await query(
      `INSERT INTO password_reset_tokens (physician_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [physician.id, token, expiresAt]
    );

    // In production, send email here (never log or return the token)
    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/auth/reset-password/${token}`;
    // TODO: Send email with reset link (ensure HIPAA-compliant provider/BAA)
    // await sendPasswordResetEmail(physician.email, resetUrl);

    const res = NextResponse.json({
      success: true,
      message: "If an account exists with this email, a password reset link has been sent.",
    });
    logRequestMeta("/api/auth/reset-password", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[auth/reset-password] Error processing reset");
    logDebug("[auth/reset-password] Error details", {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    status = 500;
    const res = NextResponse.json(
      { error: "Internal server error" },
      { status }
    );
    logRequestMeta("/api/auth/reset-password", requestId, status, Date.now() - started);
    return res;
  }
}

