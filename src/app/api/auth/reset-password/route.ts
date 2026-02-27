/**
 * POST /api/auth/reset-password
 * Request password reset (sends email with reset token)
 */

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { query } from "@/lib/db";
import { randomBytes } from "crypto";
import { logDebug } from "@/lib/secure-logger";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { hashResetToken } from "@/lib/reset-token-security";
import { consumeDbRateLimit } from "@/lib/rate-limit";
import { getRequestIp } from "@/lib/invitation-security";
import { getExpectedTokenClaims } from "@/lib/token-claims";

const RESET_TOKEN_EXPIRY_HOURS = 24;
const RESET_REQUEST_MAX_ATTEMPTS = 5;
const RESET_REQUEST_WINDOW_SECONDS = 15 * 60;
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const ip = getRequestIp(request.headers);
    const limiter = await consumeDbRateLimit({
      bucketKey: `auth-reset-request:${ip}`,
      maxAttempts: RESET_REQUEST_MAX_ATTEMPTS,
      windowSeconds: RESET_REQUEST_WINDOW_SECONDS,
    });
    if (!limiter.allowed) {
      status = 429;
      const res = NextResponse.json(
        {
          error: "Too many password reset attempts. Please try again later.",
          retryAfterSeconds: limiter.retryAfterSeconds,
        },
        { status },
      );
      logRequestMeta("/api/auth/reset-password", requestId, status, Date.now() - started);
      return res;
    }

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

    // Keep one active reset token per account.
    await query(
      `UPDATE password_reset_tokens
       SET used = TRUE
       WHERE physician_id = $1
         AND used = FALSE
         AND expires_at > NOW()`,
      [physician.id],
    );

    // Generate reset token
    const token = randomBytes(32).toString("hex");
    const tokenHash = hashResetToken(token);
    const tokenClaims = getExpectedTokenClaims("password_reset", "auth_password_reset");
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + RESET_TOKEN_EXPIRY_HOURS);

    // Store reset token hash (raw token is only delivered to the user)
    await query(
      `INSERT INTO password_reset_tokens (physician_id, token_hash, expires_at, token_iss, token_aud, token_type, token_context)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        physician.id,
        tokenHash,
        expiresAt,
        tokenClaims.iss,
        tokenClaims.aud,
        tokenClaims.type,
        tokenClaims.context,
      ]
    );

    // Send reset link via configured email provider.
    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/auth/reset-password/${token}`;
    if (resend && process.env.HIPAA_MODE !== "true") {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
        to: physician.email,
        subject: "Reset your Health Assist AI password",
        html: `<p>We received a request to reset your password.</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in ${RESET_TOKEN_EXPIRY_HOURS} hours.</p>`,
        text: `We received a request to reset your password.\n\nReset password: ${resetUrl}\n\nThis link expires in ${RESET_TOKEN_EXPIRY_HOURS} hours.`,
      });
    } else {
      logDebug("[auth/reset-password] Reset email not sent (email provider disabled or HIPAA mode enabled)", {
        hasResend: Boolean(resend),
        hipaaMode: process.env.HIPAA_MODE === "true",
      });
    }

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

