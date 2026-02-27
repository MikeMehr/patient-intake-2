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
import {
  consumeVerifiedMfaChallenge,
  hashMfaContextToken,
  issueMfaChallenge,
  verifyMfaChallenge,
} from "@/lib/auth-mfa";
import {
  assessPasswordAgainstBreaches,
  BREACHED_PASSWORD_ERROR,
  BREACH_CHECK_UNAVAILABLE_ERROR,
} from "@/lib/password-breach";

const RESET_CONSUME_MAX_ATTEMPTS = 10;
const RESET_CONSUME_WINDOW_SECONDS = 15 * 60;

type ResetAction = "request_mfa" | "verify_mfa" | "reset_password";

async function getValidResetToken(token: string, tokenHash: string) {
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
    [tokenHash, token],
  );
  return tokenResult.rows[0] || null;
}

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
    const action = (body?.action || "reset_password") as ResetAction;
    const challengeToken = (body?.challengeToken || "").trim();
    const otpCode = (body?.otpCode || "").trim();
    const contextTokenHash = hashMfaContextToken(token);

    const resetToken = await getValidResetToken(token, tokenHash);
    if (!resetToken) {
      return NextResponse.json(
        { error: "Invalid or expired reset token" },
        { status: 400 }
      );
    }

    const physicianResult = await query<{
      id: string;
      email: string | null;
      mfa_enabled: boolean;
    }>(
      `SELECT id, email, mfa_enabled
       FROM physicians
       WHERE id = $1
       LIMIT 1`,
      [resetToken.physician_id],
    );
    const physician = physicianResult.rows[0];
    if (!physician) {
      return NextResponse.json(
        { error: "Invalid or expired reset token" },
        { status: 400 },
      );
    }

    if (action === "request_mfa") {
      if (!physician.mfa_enabled) {
        return NextResponse.json({
          success: true,
          mfaRequired: false,
        });
      }
      const challenge = await issueMfaChallenge({
        user: {
          userType: "provider",
          userId: physician.id,
          email: physician.email,
        },
        purpose: "password_reset",
        ipAddress: ip,
        userAgent: request.headers.get("user-agent"),
        contextTokenHash,
      });
      return NextResponse.json({
        success: true,
        mfaRequired: true,
        challengeToken: challenge.challengeToken,
        expiresInSeconds: challenge.expiresInSeconds,
      });
    }

    if (action === "verify_mfa") {
      if (!physician.mfa_enabled) {
        return NextResponse.json({ success: true, mfaRequired: false });
      }
      if (!challengeToken || !otpCode) {
        return NextResponse.json(
          { error: "Verification code is required" },
          { status: 400 },
        );
      }
      const verification = await verifyMfaChallenge({
        challengeToken,
        otpCode,
        purpose: "password_reset",
        contextTokenHash,
      });
      if (!verification.ok) {
        return NextResponse.json(
          { error: "Invalid or expired verification code" },
          { status: 400 },
        );
      }
      return NextResponse.json({ success: true, mfaVerified: true });
    }

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

    const breachAssessment = await assessPasswordAgainstBreaches(newPassword);
    if (breachAssessment.unavailable && !breachAssessment.failOpen) {
      return NextResponse.json(
        { error: BREACH_CHECK_UNAVAILABLE_ERROR },
        { status: 503 },
      );
    }
    if (breachAssessment.breached) {
      return NextResponse.json(
        { error: BREACHED_PASSWORD_ERROR },
        { status: 400 },
      );
    }

    if (physician.mfa_enabled) {
      if (!challengeToken) {
        return NextResponse.json(
          { error: "MFA verification is required before resetting password" },
          { status: 400 },
        );
      }
      const consumed = await consumeVerifiedMfaChallenge({
        challengeToken,
        purpose: "password_reset",
        contextTokenHash,
      });
      if (!consumed.ok) {
        return NextResponse.json(
          { error: "MFA verification is required before resetting password" },
          { status: 400 },
        );
      }
    }

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

