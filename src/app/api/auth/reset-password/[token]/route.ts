/**
 * POST /api/auth/reset-password/[token]
 * Reset password using token
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { hashPassword, validatePassword } from "@/lib/auth";
import { hashResetToken } from "@/lib/reset-token-security";
import { getRequestIp } from "@/lib/invitation-security";
import { consumeDbRateLimit } from "@/lib/rate-limit";

const RESET_CONSUME_MAX_ATTEMPTS = 10;
const RESET_CONSUME_WINDOW_SECONDS = 15 * 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const tokenHash = hashResetToken(token);
    const ip = getRequestIp(request.headers);
    const limiter = await consumeDbRateLimit({
      bucketKey: `auth-reset-consume:${ip}:${tokenHash}`,
      maxAttempts: RESET_CONSUME_MAX_ATTEMPTS,
      windowSeconds: RESET_CONSUME_WINDOW_SECONDS,
    });
    if (!limiter.allowed) {
      return NextResponse.json(
        {
          error: "Too many reset attempts. Please try again later.",
          retryAfterSeconds: limiter.retryAfterSeconds,
        },
        { status: 429 },
      );
    }
    const body = await request.json();
    const { newPassword } = body;

    if (!newPassword) {
      return NextResponse.json(
        { error: "New password is required" },
        { status: 400 }
      );
    }

    // Validate password complexity
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.valid) {
      return NextResponse.json(
        { error: passwordValidation.error },
        { status: 400 }
      );
    }

    // Find valid reset token
    const tokenResult = await query<{
      id: string;
      physician_id: string;
      expires_at: Date;
      used: boolean;
    }>(
      `SELECT id, physician_id, expires_at, used
       FROM password_reset_tokens
       WHERE (token_hash = $1 OR token = $2)
         AND expires_at > NOW()
         AND used = FALSE
       ORDER BY created_at DESC
       LIMIT 1`,
      [tokenHash, token]
    );

    if (tokenResult.rows.length === 0) {
      return NextResponse.json(
        { error: "Invalid or expired reset token" },
        { status: 400 }
      );
    }

    const resetToken = tokenResult.rows[0];

    // Hash new password
    const passwordHash = await hashPassword(newPassword);

    // Update password
    await query(
      `UPDATE physicians SET password_hash = $1 WHERE id = $2`,
      [passwordHash, resetToken.physician_id]
    );

    // Mark token as used
    await query(
      `UPDATE password_reset_tokens SET used = TRUE WHERE id = $1`,
      [resetToken.id]
    );

    // Invalidate all existing sessions for this physician
    await query(
      `DELETE FROM physician_sessions WHERE physician_id = $1`,
      [resetToken.physician_id]
    );

    return NextResponse.json({
      success: true,
      message: "Password has been reset successfully",
    });
  } catch (error) {
    console.error("[auth/reset-password/token] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

