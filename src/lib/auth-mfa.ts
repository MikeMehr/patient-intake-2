import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { Resend } from "resend";
import { query } from "@/lib/db";
import type { UserType } from "@/lib/auth";

const OTP_TTL_MINUTES = 10;
const OTP_COOLDOWN_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_DIGITS = 6;

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export type MfaPurpose = "login" | "password_reset";

export type MfaUser = {
  userType: UserType;
  userId: string;
  email: string | null;
};

function getMfaSecret(): string {
  const secret = process.env.AUTH_MFA_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("AUTH_MFA_SECRET or SESSION_SECRET is required");
  }
  return secret;
}

function hashValue(value: string): string {
  return createHmac("sha256", getMfaSecret()).update(value).digest("hex");
}

function safeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function createOtpCode(): string {
  const code = randomBytes(4).readUInt32BE(0) % 10 ** OTP_DIGITS;
  return code.toString().padStart(OTP_DIGITS, "0");
}

function createChallengeToken(): string {
  return randomBytes(32).toString("hex");
}

function auditMfaEvent(event: {
  purpose: MfaPurpose;
  action: "challenge_issued" | "challenge_verified" | "challenge_failed" | "challenge_consumed";
  outcome: "success" | "failure";
  userType?: UserType;
  userId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}) {
  if (process.env.AUDIT_LOG_ENABLED !== "true") return;
  console.info("[auth/mfa/audit]", {
    event: "mfa",
    purpose: event.purpose,
    action: event.action,
    outcome: event.outcome,
    userType: event.userType || null,
    userId: event.userId || null,
    reason: event.reason || null,
    metadata: event.metadata || null,
    ts: new Date().toISOString(),
  });
}

async function sendOtpEmail(params: {
  to: string;
  otpCode: string;
  purpose: MfaPurpose;
}): Promise<boolean> {
  if (!resend || process.env.HIPAA_MODE === "true") return false;
  const subject =
    params.purpose === "login"
      ? "Your Health Assist sign-in verification code"
      : "Your Health Assist password reset verification code";
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
    to: params.to,
    subject,
    html: `<p>Your verification code is <strong>${params.otpCode}</strong>.</p><p>This code expires in ${OTP_TTL_MINUTES} minutes.</p>`,
    text: `Your verification code is ${params.otpCode}. It expires in ${OTP_TTL_MINUTES} minutes.`,
  });
  return true;
}

export async function issueMfaChallenge(params: {
  user: MfaUser;
  purpose: MfaPurpose;
  ipAddress?: string | null;
  userAgent?: string | null;
  contextTokenHash?: string | null;
}): Promise<{ challengeToken: string; expiresInSeconds: number; emailDeliveryEnabled: boolean }> {
  const challengeToken = createChallengeToken();
  const challengeTokenHash = hashValue(challengeToken);
  const otpCode = createOtpCode();
  const otpHash = hashValue(otpCode);

  // Keep only one active challenge for a user/purpose/context.
  await query(
    `UPDATE auth_mfa_challenges
     SET consumed_at = NOW(),
         updated_at = NOW()
     WHERE user_type = $1
       AND user_id = $2
       AND purpose = $3
       AND consumed_at IS NULL
       AND verified_at IS NULL
       AND COALESCE(context_token_hash, '') = COALESCE($4, '')`,
    [params.user.userType, params.user.userId, params.purpose, params.contextTokenHash || null],
  );

  await query(
    `INSERT INTO auth_mfa_challenges (
      user_type, user_id, purpose, challenge_token_hash, otp_hash, context_token_hash,
      expires_at, attempt_count, max_attempts, cooldown_until, ip_address, user_agent
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      NOW() + ($7 * INTERVAL '1 minute'), 0, $8, NULL, $9, $10
    )`,
    [
      params.user.userType,
      params.user.userId,
      params.purpose,
      challengeTokenHash,
      otpHash,
      params.contextTokenHash || null,
      OTP_TTL_MINUTES,
      OTP_MAX_ATTEMPTS,
      params.ipAddress || null,
      params.userAgent || null,
    ],
  );

  const emailDeliveryEnabled = Boolean(params.user.email);
  if (params.user.email) {
    await sendOtpEmail({
      to: params.user.email,
      otpCode,
      purpose: params.purpose,
    });
  }

  auditMfaEvent({
    purpose: params.purpose,
    action: "challenge_issued",
    outcome: "success",
    userType: params.user.userType,
    userId: params.user.userId,
    metadata: { emailDeliveryEnabled },
  });

  return {
    challengeToken,
    expiresInSeconds: OTP_TTL_MINUTES * 60,
    emailDeliveryEnabled,
  };
}

export async function verifyMfaChallenge(params: {
  challengeToken: string;
  otpCode: string;
  purpose: MfaPurpose;
  contextTokenHash?: string | null;
}): Promise<{
  ok: boolean;
  reason?: "missing" | "expired" | "cooldown" | "max_attempts" | "invalid" | "context_mismatch";
}> {
  const challengeTokenHash = hashValue(params.challengeToken);
  const result = await query<{
    id: string;
    user_type: UserType;
    user_id: string;
    otp_hash: string;
    expires_at: Date;
    attempt_count: number;
    max_attempts: number;
    cooldown_until: Date | null;
    context_token_hash: string | null;
  }>(
    `SELECT id, user_type, user_id, otp_hash, expires_at, attempt_count, max_attempts, cooldown_until, context_token_hash
     FROM auth_mfa_challenges
     WHERE challenge_token_hash = $1
       AND purpose = $2
       AND consumed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [challengeTokenHash, params.purpose],
  );

  if (result.rows.length === 0) {
    auditMfaEvent({
      purpose: params.purpose,
      action: "challenge_failed",
      outcome: "failure",
      reason: "missing",
    });
    return { ok: false, reason: "missing" };
  }

  const challenge = result.rows[0];
  if (challenge.expires_at.getTime() <= Date.now()) {
    auditMfaEvent({
      purpose: params.purpose,
      action: "challenge_failed",
      outcome: "failure",
      userType: challenge.user_type,
      userId: challenge.user_id,
      reason: "expired",
    });
    return { ok: false, reason: "expired" };
  }
  if (challenge.cooldown_until && challenge.cooldown_until.getTime() > Date.now()) {
    return { ok: false, reason: "cooldown" };
  }
  if (challenge.attempt_count >= challenge.max_attempts) {
    return { ok: false, reason: "max_attempts" };
  }
  if (
    (params.contextTokenHash || null) !== (challenge.context_token_hash || null)
  ) {
    auditMfaEvent({
      purpose: params.purpose,
      action: "challenge_failed",
      outcome: "failure",
      userType: challenge.user_type,
      userId: challenge.user_id,
      reason: "context_mismatch",
    });
    return { ok: false, reason: "context_mismatch" };
  }

  const otpHash = hashValue(params.otpCode);
  if (!safeCompare(challenge.otp_hash, otpHash)) {
    const nextAttempts = challenge.attempt_count + 1;
    const shouldCooldown = nextAttempts >= challenge.max_attempts;
    await query(
      `UPDATE auth_mfa_challenges
       SET attempt_count = $2,
           cooldown_until = CASE
             WHEN $3::boolean THEN NOW() + ($4 * INTERVAL '1 minute')
             ELSE cooldown_until
           END,
           updated_at = NOW()
       WHERE id = $1`,
      [challenge.id, nextAttempts, shouldCooldown, OTP_COOLDOWN_MINUTES],
    );
    auditMfaEvent({
      purpose: params.purpose,
      action: "challenge_failed",
      outcome: "failure",
      userType: challenge.user_type,
      userId: challenge.user_id,
      reason: "invalid",
    });
    return { ok: false, reason: "invalid" };
  }

  await query(
    `UPDATE auth_mfa_challenges
     SET verified_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [challenge.id],
  );
  auditMfaEvent({
    purpose: params.purpose,
    action: "challenge_verified",
    outcome: "success",
    userType: challenge.user_type,
    userId: challenge.user_id,
  });
  return { ok: true };
}

export async function consumeVerifiedMfaChallenge(params: {
  challengeToken: string;
  purpose: MfaPurpose;
  contextTokenHash?: string | null;
}): Promise<{
  ok: boolean;
  user?: { userType: UserType; userId: string };
}> {
  const challengeTokenHash = hashValue(params.challengeToken);
  const result = await query<{
    id: string;
    user_type: UserType;
    user_id: string;
    verified_at: Date | null;
    consumed_at: Date | null;
    expires_at: Date;
    context_token_hash: string | null;
  }>(
    `SELECT id, user_type, user_id, verified_at, consumed_at, expires_at, context_token_hash
     FROM auth_mfa_challenges
     WHERE challenge_token_hash = $1
       AND purpose = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [challengeTokenHash, params.purpose],
  );

  if (result.rows.length === 0) return { ok: false };
  const challenge = result.rows[0];
  if (challenge.consumed_at || !challenge.verified_at) return { ok: false };
  if (challenge.expires_at.getTime() <= Date.now()) return { ok: false };
  if ((params.contextTokenHash || null) !== (challenge.context_token_hash || null)) return { ok: false };

  await query(
    `UPDATE auth_mfa_challenges
     SET consumed_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [challenge.id],
  );
  auditMfaEvent({
    purpose: params.purpose,
    action: "challenge_consumed",
    outcome: "success",
    userType: challenge.user_type,
    userId: challenge.user_id,
  });
  return {
    ok: true,
    user: {
      userType: challenge.user_type,
      userId: challenge.user_id,
    },
  };
}

export function hashMfaContextToken(token: string): string {
  return hashValue(token);
}
