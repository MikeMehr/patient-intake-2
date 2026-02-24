import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies, headers } from "next/headers";
import { query } from "@/lib/db";

export const INVITATION_SESSION_COOKIE = "invitation_session";
const INVITE_TOKEN_BYTES = 32;
const OTP_TTL_MINUTES = 10;
const OTP_COOLDOWN_MINUTES = 5;
const INVITE_TOKEN_TTL_HOURS = 24;
// Verified invitation session lifetime (httpOnly cookie + DB session). This is distinct
// from the invite link token TTL. Keep it short to reduce exposure if a device is shared.
const INVITATION_SESSION_TTL_HOURS = 1;

type InvitationRow = {
  id: string;
  physician_id: string;
  patient_email: string;
  patient_name: string;
  oscar_demographic_no: string | null;
  token_expires_at: Date | null;
  used_at: Date | null;
  revoked_at: Date | null;
  expires_at: Date | null;
  lab_report_summary: string | null;
  previous_lab_report_summary: string | null;
  form_summary: string | null;
  summary_expires_at: Date | null;
  summary_deleted_at: Date | null;
  patient_background: string | null;
  interview_guidance: string | null;
  first_name: string;
  last_name: string;
  clinic_name: string;
};

export type InvitationContext = {
  invitationId: string;
  physicianId: string;
  patientEmail: string;
  patientName: string;
  oscarDemographicNo: string | null;
  physicianName: string;
  clinicName: string;
  tokenExpiresAt: string | null;
  usedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
  labReportSummary: string | null;
  previousLabReportSummary: string | null;
  formSummary: string | null;
  summaryExpiresAt: string | null;
  summaryDeletedAt: string | null;
  patientBackground: string | null;
  interviewGuidance: string | null;
};

type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

function getSessionSecret(): string {
  const secret = process.env.INVITATION_SESSION_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV !== "production") {
      return "dev-only-invitation-secret-change-me";
    }
    throw new Error("INVITATION_SESSION_SECRET or SESSION_SECRET is required");
  }
  return secret;
}

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function fromBase64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

export function getRequestIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    return fwd.split(",")[0].trim();
  }
  return headers.get("x-real-ip") || "unknown";
}

export function hashValue(value: string): string {
  return createHmac("sha256", getSessionSecret()).update(value).digest("hex");
}

function signPayload(payloadBase64Url: string): string {
  return createHmac("sha256", getSessionSecret())
    .update(payloadBase64Url)
    .digest("base64url");
}

function safeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function toInvitationContext(row: InvitationRow): InvitationContext {
  const hasAnySummary = Boolean(
    row.lab_report_summary || row.previous_lab_report_summary || row.form_summary,
  );
  const summaryDeleted = Boolean(row.summary_deleted_at);
  const summaryExpired = Boolean(
    row.summary_expires_at && new Date(row.summary_expires_at).getTime() <= Date.now(),
  );
  const summaryActive = hasAnySummary && !summaryDeleted && !summaryExpired;

  return {
    invitationId: row.id,
    physicianId: row.physician_id,
    patientEmail: row.patient_email,
    patientName: row.patient_name,
    oscarDemographicNo: row.oscar_demographic_no,
    physicianName: `Dr. ${row.first_name} ${row.last_name}`,
    clinicName: row.clinic_name,
    tokenExpiresAt: row.token_expires_at ? new Date(row.token_expires_at).toISOString() : null,
    usedAt: row.used_at ? new Date(row.used_at).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    labReportSummary: summaryActive ? row.lab_report_summary : null,
    previousLabReportSummary: summaryActive ? row.previous_lab_report_summary : null,
    formSummary: summaryActive ? row.form_summary : null,
    summaryExpiresAt: row.summary_expires_at ? new Date(row.summary_expires_at).toISOString() : null,
    summaryDeletedAt: row.summary_deleted_at ? new Date(row.summary_deleted_at).toISOString() : null,
    patientBackground: row.patient_background,
    interviewGuidance: row.interview_guidance,
  };
}

export function createInvitationToken(): { rawToken: string; tokenHash: string; expiresAt: Date } {
  const rawToken = randomBytes(INVITE_TOKEN_BYTES).toString("hex");
  const tokenHash = hashValue(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_HOURS * 60 * 60 * 1000);
  return { rawToken, tokenHash, expiresAt };
}

export function createOtpCode(): string {
  const code = randomBytes(4).readUInt32BE(0) % 1000000;
  return code.toString().padStart(6, "0");
}

export async function consumeRateLimit(
  bucketKey: string,
  maxAttempts: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const result = await query<{ attempt_count: number; expires_at: Date }>(
    `INSERT INTO invitation_rate_limits (bucket_key, attempt_count, window_start, expires_at)
     VALUES ($1, 1, NOW(), NOW() + ($2 * INTERVAL '1 second'))
     ON CONFLICT (bucket_key)
     DO UPDATE SET
       attempt_count = CASE
         WHEN invitation_rate_limits.expires_at <= NOW() THEN 1
         ELSE invitation_rate_limits.attempt_count + 1
       END,
       window_start = CASE
         WHEN invitation_rate_limits.expires_at <= NOW() THEN NOW()
         ELSE invitation_rate_limits.window_start
       END,
       expires_at = CASE
         WHEN invitation_rate_limits.expires_at <= NOW()
           THEN NOW() + ($2 * INTERVAL '1 second')
         ELSE invitation_rate_limits.expires_at
       END
     RETURNING attempt_count, expires_at`,
    [bucketKey, windowSeconds],
  );

  const row = result.rows[0];
  const retryAfterSeconds = Math.max(
    0,
    Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / 1000),
  );
  return {
    allowed: row.attempt_count <= maxAttempts,
    retryAfterSeconds,
  };
}

export async function logInvitationAudit(params: {
  invitationId: string | null;
  eventType: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  await query(
    `INSERT INTO invitation_audit_log (invitation_id, event_type, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      params.invitationId,
      params.eventType,
      params.ipAddress || null,
      params.userAgent || null,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ],
  );
}

export async function getInvitationByRawToken(rawToken: string): Promise<InvitationContext | null> {
  const tokenHash = hashValue(rawToken);
  const result = await query<InvitationRow>(
    `SELECT pi.id, pi.physician_id, pi.patient_email, pi.patient_name, pi.oscar_demographic_no, pi.token_expires_at, pi.used_at, pi.revoked_at,
            pi.expires_at, pi.lab_report_summary, pi.previous_lab_report_summary, pi.form_summary, pi.summary_expires_at, pi.summary_deleted_at, pi.patient_background,
            pi.interview_guidance, p.first_name, p.last_name, p.clinic_name
     FROM patient_invitations pi
     JOIN physicians p ON p.id = pi.physician_id
     WHERE pi.token_hash = $1
     ORDER BY pi.sent_at DESC NULLS LAST, pi.created_at DESC NULLS LAST
     LIMIT 1`,
    [tokenHash],
  );

  if (result.rows.length === 0) return null;
  return toInvitationContext(result.rows[0]);
}

export async function isInvitationOpenable(invite: InvitationContext): Promise<boolean> {
  if (invite.revokedAt) return false;
  if (invite.usedAt) return false;
  const expiry = invite.tokenExpiresAt || invite.expiresAt;
  if (!expiry) return true;
  return new Date(expiry).getTime() > Date.now();
}

export function createInvitationSessionCookie(params: {
  invitationId: string;
  sessionToken: string;
  expiresAtEpochMs: number;
}): string {
  const payload = JSON.stringify({
    invitationId: params.invitationId,
    sessionToken: params.sessionToken,
    exp: params.expiresAtEpochMs,
  });
  const payloadB64 = toBase64Url(payload);
  const sig = signPayload(payloadB64);
  return `${payloadB64}.${sig}`;
}

function parseInvitationSessionCookie(cookieValue: string): {
  invitationId: string;
  sessionToken: string;
  exp: number;
} | null {
  const [payloadB64, sig] = cookieValue.split(".");
  if (!payloadB64 || !sig) return null;
  const expected = signPayload(payloadB64);
  if (!safeCompare(expected, sig)) return null;

  try {
    const parsed = JSON.parse(fromBase64Url(payloadB64)) as {
      invitationId?: string;
      sessionToken?: string;
      exp?: number;
    };
    if (!parsed.invitationId || !parsed.sessionToken || !parsed.exp) return null;
    if (parsed.exp < Date.now()) return null;
    return {
      invitationId: parsed.invitationId,
      sessionToken: parsed.sessionToken,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

export async function resolveInvitationFromCookie(): Promise<InvitationContext | null> {
  // Some browsers (notably Safari) can send multiple cookies with the same name
  // when the domain attribute differs (host-only vs parent domain). Next's
  // cookie helper may collapse duplicates, so we also parse the raw Cookie
  // header to preserve all values and select the newest valid session.
  const candidates: string[] = [];

  try {
    const headerStore = await headers();
    const cookieHeader = headerStore.get("cookie") || "";
    const parts = cookieHeader.split(";").map((p) => p.trim());
    for (const part of parts) {
      if (part.startsWith(`${INVITATION_SESSION_COOKIE}=`)) {
        const value = part.slice(`${INVITATION_SESSION_COOKIE}=`.length);
        if (value) candidates.push(value);
      }
    }
  } catch {
    // Ignore and fall back to cookies() below.
  }

  if (candidates.length === 0) {
    const cookieStore = await cookies();
    const rawCookie = cookieStore.get(INVITATION_SESSION_COOKIE)?.value;
    if (rawCookie) candidates.push(rawCookie);
  }

  if (candidates.length === 0) return null;

  // Prefer the last cookie in the header (most recently set).
  for (let idx = candidates.length - 1; idx >= 0; idx -= 1) {
    const parsed = parseInvitationSessionCookie(candidates[idx]);
    if (!parsed) continue;

    const sessionHash = hashValue(parsed.sessionToken);
    const result = await query<InvitationRow>(
      `SELECT pi.id, pi.physician_id, pi.patient_email, pi.patient_name, pi.oscar_demographic_no, pi.token_expires_at, pi.used_at, pi.revoked_at,
              pi.expires_at, pi.lab_report_summary, pi.previous_lab_report_summary, pi.form_summary, pi.summary_expires_at, pi.summary_deleted_at, pi.patient_background,
              pi.interview_guidance, p.first_name, p.last_name, p.clinic_name
       FROM invitation_sessions isess
       JOIN patient_invitations pi ON pi.id = isess.invitation_id
       JOIN physicians p ON p.id = pi.physician_id
       WHERE isess.invitation_id = $1
         AND isess.session_token_hash = $2
         AND isess.expires_at > NOW()
       LIMIT 1`,
      [parsed.invitationId, sessionHash],
    );
    if (result.rows.length === 0) continue;

    await query(
      `UPDATE invitation_sessions
       SET last_accessed_at = NOW()
       WHERE invitation_id = $1 AND session_token_hash = $2`,
      [parsed.invitationId, sessionHash],
    );

    const invite = toInvitationContext(result.rows[0]);
    if (invite.revokedAt) return null;
    if (invite.expiresAt && new Date(invite.expiresAt).getTime() <= Date.now()) return null;
    return invite;
  }

  return null;
}

export async function upsertOtpChallenge(invitationId: string, otpCode: string): Promise<void> {
  const otpHash = hashValue(otpCode);
  await query(
    `INSERT INTO invitation_otp_challenges (invitation_id, otp_hash, expires_at, attempt_count, max_attempts, cooldown_until)
     VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 minute'), 0, 5, NULL)`,
    [invitationId, otpHash, OTP_TTL_MINUTES],
  );
}

export async function verifyOtpForInvitation(params: {
  invitationId: string;
  otpCode: string;
}): Promise<{
  ok: boolean;
  reason?: "expired" | "cooldown" | "max_attempts" | "invalid" | "missing";
}> {
  const challengeResult = await query<{
    id: string;
    otp_hash: string;
    expires_at: Date;
    attempt_count: number;
    max_attempts: number;
    cooldown_until: Date | null;
  }>(
    `SELECT id, otp_hash, expires_at, attempt_count, max_attempts, cooldown_until
     FROM invitation_otp_challenges
     WHERE invitation_id = $1
       AND verified_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [params.invitationId],
  );

  if (challengeResult.rows.length === 0) return { ok: false, reason: "missing" };
  const challenge = challengeResult.rows[0];
  if (challenge.expires_at.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  if (challenge.cooldown_until && challenge.cooldown_until.getTime() > Date.now()) {
    return { ok: false, reason: "cooldown" };
  }
  if (challenge.attempt_count >= challenge.max_attempts) {
    return { ok: false, reason: "max_attempts" };
  }

  const otpHash = hashValue(params.otpCode);
  if (!safeCompare(challenge.otp_hash, otpHash)) {
    const nextAttempts = challenge.attempt_count + 1;
    const shouldCooldown = nextAttempts >= challenge.max_attempts;
    await query(
      `UPDATE invitation_otp_challenges
       SET attempt_count = $2,
           cooldown_until = CASE
             WHEN $3::boolean THEN NOW() + ($4 * INTERVAL '1 minute')
             ELSE cooldown_until
           END
       WHERE id = $1`,
      [challenge.id, nextAttempts, shouldCooldown, OTP_COOLDOWN_MINUTES],
    );
    await query(
      `UPDATE patient_invitations
       SET attempt_count = attempt_count + 1
       WHERE id = $1`,
      [params.invitationId],
    );
    return { ok: false, reason: "invalid" };
  }

  await query(
    `UPDATE invitation_otp_challenges
     SET verified_at = NOW()
     WHERE id = $1`,
    [challenge.id],
  );
  return { ok: true };
}

export async function createInvitationSession(params: {
  invitationId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{ cookieValue: string; expiresAtMs: number }> {
  const sessionToken = randomBytes(INVITE_TOKEN_BYTES).toString("hex");
  const sessionHash = hashValue(sessionToken);
  const expiresAtMs = Date.now() + INVITATION_SESSION_TTL_HOURS * 60 * 60 * 1000;
  const expiresAt = new Date(expiresAtMs);

  await query(
    `INSERT INTO invitation_sessions (invitation_id, session_token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [params.invitationId, sessionHash, expiresAt, params.ipAddress || null, params.userAgent || null],
  );

  const cookieValue = createInvitationSessionCookie({
    invitationId: params.invitationId,
    sessionToken,
    expiresAtEpochMs: expiresAtMs,
  });

  return { cookieValue, expiresAtMs };
}

export async function markInvitationUsed(invitationId: string): Promise<void> {
  await query(
    `UPDATE patient_invitations
     SET used_at = COALESCE(used_at, NOW())
     WHERE id = $1`,
    [invitationId],
  );
}

export async function clearInvitationSummaries(invitationId: string): Promise<void> {
  await query(
    `UPDATE patient_invitations
     SET lab_report_summary = NULL,
         previous_lab_report_summary = NULL,
         form_summary = NULL,
         summary_expires_at = NULL,
         summary_deleted_at = COALESCE(summary_deleted_at, NOW())
     WHERE id = $1`,
    [invitationId],
  );
}

export async function clearExpiredInvitationSummaries(): Promise<number> {
  const result = await query(
    `UPDATE patient_invitations
     SET lab_report_summary = NULL,
         previous_lab_report_summary = NULL,
         form_summary = NULL,
         summary_expires_at = NULL,
         summary_deleted_at = COALESCE(summary_deleted_at, NOW())
     WHERE summary_deleted_at IS NULL
       AND summary_expires_at IS NOT NULL
       AND summary_expires_at <= NOW()
       AND (
         lab_report_summary IS NOT NULL OR
         previous_lab_report_summary IS NOT NULL OR
         form_summary IS NOT NULL
       )`,
  );
  return result.rowCount ?? 0;
}

export async function clearInactiveInvitationSummaries(): Promise<number> {
  const result = await query(
    `UPDATE patient_invitations
     SET lab_report_summary = NULL,
         previous_lab_report_summary = NULL,
         form_summary = NULL,
         summary_expires_at = NULL,
         summary_deleted_at = COALESCE(summary_deleted_at, NOW())
     WHERE summary_deleted_at IS NULL
       AND (
         revoked_at IS NOT NULL OR
         (expires_at IS NOT NULL AND expires_at <= NOW())
       )
       AND (
         lab_report_summary IS NOT NULL OR
         previous_lab_report_summary IS NOT NULL OR
         form_summary IS NOT NULL
       )`,
  );
  return result.rowCount ?? 0;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const safeLocal =
    local.length <= 2
      ? `${local.slice(0, 1)}*`
      : `${local.slice(0, 2)}${"*".repeat(Math.max(local.length - 2, 1))}`;
  return `${safeLocal}@${domain}`;
}
