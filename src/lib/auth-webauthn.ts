/**
 * WebAuthn / Passkey authentication
 * Registration and authentication using FIDO2/WebAuthn credentials.
 * Follows the same patterns as auth-mfa.ts (raw SQL, atomic consumption, audit logging).
 */

import {
  generateRegistrationOptions as generateRegOptions,
  verifyRegistrationResponse as verifyRegResponse,
  generateAuthenticationOptions as generateAuthOptions,
  verifyAuthenticationResponse as verifyAuthResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { query } from "@/lib/db";
import type { UserType } from "@/lib/auth";

const CHALLENGE_TTL_MINUTES = 5;

function getWebAuthnConfig() {
  const rpID = process.env.WEBAUTHN_RP_ID;
  const rpName = process.env.WEBAUTHN_RP_NAME || "Health Assist AI";
  const origin = process.env.WEBAUTHN_ORIGIN;

  if (!rpID || !origin) {
    throw new Error("WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN environment variables are required");
  }

  return { rpID, rpName, origin };
}

function auditWebAuthnEvent(event: {
  action: string;
  outcome: "success" | "failure";
  userType?: UserType | null;
  userId?: string | null;
  reason?: string;
  metadata?: Record<string, unknown>;
}) {
  if (process.env.AUDIT_LOG_ENABLED !== "true") return;
  console.info("[auth/webauthn/audit]", {
    event: "webauthn",
    action: event.action,
    outcome: event.outcome,
    userType: event.userType || null,
    userId: event.userId || null,
    reason: event.reason || null,
    metadata: event.metadata || null,
    ts: new Date().toISOString(),
  });
}

// ── Registration (Phase 2) ──────────────────────────────────────────

export async function generateRegistrationOpts(params: {
  userType: UserType;
  userId: string;
  username: string;
  displayName: string;
}): Promise<{ options: ReturnType<typeof generateRegOptions> extends Promise<infer T> ? T : never; challenge: string }> {
  const { rpID, rpName } = getWebAuthnConfig();

  // Fetch existing credentials for exclude list
  const existing = await query<{ credential_id: string; transports: string[] | null }>(
    `SELECT credential_id, transports FROM webauthn_credentials
     WHERE user_type = $1 AND user_id = $2`,
    [params.userType, params.userId],
  );

  const excludeCredentials = existing.rows.map((row) => ({
    id: row.credential_id,
    transports: (row.transports || []) as AuthenticatorTransportFuture[],
  }));

  const options = await generateRegOptions({
    rpName,
    rpID,
    userName: params.username,
    userDisplayName: params.displayName,
    excludeCredentials,
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    attestationType: "none",
  });

  // Store challenge
  await query(
    `INSERT INTO webauthn_challenges (challenge, user_type, user_id, purpose, expires_at, ip_address)
     VALUES ($1, $2, $3, 'registration', NOW() + ($4 * INTERVAL '1 minute'), $5)`,
    [options.challenge, params.userType, params.userId, CHALLENGE_TTL_MINUTES, null],
  );

  return { options, challenge: options.challenge };
}

export async function verifyRegistration(params: {
  userType: UserType;
  userId: string;
  response: RegistrationResponseJSON;
  expectedChallenge: string;
  deviceName?: string;
}): Promise<{ verified: boolean; credentialId?: string }> {
  const { rpID, origin } = getWebAuthnConfig();

  // Consume challenge atomically
  const challengeResult = await query<{ id: string }>(
    `UPDATE webauthn_challenges
     SET consumed_at = NOW()
     WHERE challenge = $1
       AND user_type = $2
       AND user_id = $3
       AND purpose = 'registration'
       AND consumed_at IS NULL
       AND expires_at > NOW()
     RETURNING id`,
    [params.expectedChallenge, params.userType, params.userId],
  );

  if (challengeResult.rows.length === 0) {
    auditWebAuthnEvent({
      action: "registration_verify",
      outcome: "failure",
      userType: params.userType,
      userId: params.userId,
      reason: "challenge_invalid_or_expired",
    });
    return { verified: false };
  }

  let verification;
  try {
    verification = await verifyRegResponse({
      response: params.response,
      expectedChallenge: params.expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch (error) {
    auditWebAuthnEvent({
      action: "registration_verify",
      outcome: "failure",
      userType: params.userType,
      userId: params.userId,
      reason: error instanceof Error ? error.message : "verification_error",
    });
    return { verified: false };
  }

  if (!verification.verified || !verification.registrationInfo) {
    auditWebAuthnEvent({
      action: "registration_verify",
      outcome: "failure",
      userType: params.userType,
      userId: params.userId,
      reason: "not_verified",
    });
    return { verified: false };
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  // Store credential
  await query(
    `INSERT INTO webauthn_credentials (credential_id, public_key, counter, transports, device_name, user_type, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      credential.id,
      Buffer.from(credential.publicKey),
      credential.counter,
      credential.transports || [],
      params.deviceName || "My passkey",
      params.userType,
      params.userId,
    ],
  );

  auditWebAuthnEvent({
    action: "registration_verify",
    outcome: "success",
    userType: params.userType,
    userId: params.userId,
    metadata: { credentialDeviceType, credentialBackedUp },
  });

  return { verified: true, credentialId: credential.id };
}

// ── Authentication (Phase 3) ────────────────────────────────────────

export async function generateAuthenticationOpts(params?: {
  ipAddress?: string | null;
}): Promise<{ options: ReturnType<typeof generateAuthOptions> extends Promise<infer T> ? T : never; challenge: string }> {
  const { rpID } = getWebAuthnConfig();

  const options = await generateAuthOptions({
    rpID,
    userVerification: "preferred",
    // Empty allowCredentials = discoverable credential flow (passkey)
  });

  await query(
    `INSERT INTO webauthn_challenges (challenge, purpose, expires_at, ip_address)
     VALUES ($1, 'authentication', NOW() + ($2 * INTERVAL '1 minute'), $3)`,
    [options.challenge, CHALLENGE_TTL_MINUTES, params?.ipAddress || null],
  );

  return { options, challenge: options.challenge };
}

export async function verifyAuthentication(params: {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
}): Promise<{
  verified: boolean;
  user?: { userType: UserType; userId: string };
  credentialId?: string;
}> {
  const { rpID, origin } = getWebAuthnConfig();

  // Consume challenge atomically
  const challengeResult = await query<{ id: string }>(
    `UPDATE webauthn_challenges
     SET consumed_at = NOW()
     WHERE challenge = $1
       AND purpose = 'authentication'
       AND consumed_at IS NULL
       AND expires_at > NOW()
     RETURNING id`,
    [params.expectedChallenge],
  );

  if (challengeResult.rows.length === 0) {
    auditWebAuthnEvent({
      action: "authentication_verify",
      outcome: "failure",
      reason: "challenge_invalid_or_expired",
    });
    return { verified: false };
  }

  // Look up credential
  const credResult = await query<{
    id: string;
    credential_id: string;
    public_key: Buffer;
    counter: string;
    transports: string[] | null;
    user_type: UserType;
    user_id: string;
  }>(
    `SELECT id, credential_id, public_key, counter, transports, user_type, user_id
     FROM webauthn_credentials
     WHERE credential_id = $1`,
    [params.response.id],
  );

  if (credResult.rows.length === 0) {
    auditWebAuthnEvent({
      action: "authentication_verify",
      outcome: "failure",
      reason: "credential_not_found",
    });
    return { verified: false };
  }

  const cred = credResult.rows[0];

  let verification;
  try {
    verification = await verifyAuthResponse({
      response: params.response,
      expectedChallenge: params.expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.credential_id,
        publicKey: new Uint8Array(cred.public_key),
        counter: Number(cred.counter),
        transports: (cred.transports || []) as AuthenticatorTransportFuture[],
      },
    });
  } catch (error) {
    auditWebAuthnEvent({
      action: "authentication_verify",
      outcome: "failure",
      userType: cred.user_type,
      userId: cred.user_id,
      reason: error instanceof Error ? error.message : "verification_error",
    });
    return { verified: false };
  }

  if (!verification.verified) {
    auditWebAuthnEvent({
      action: "authentication_verify",
      outcome: "failure",
      userType: cred.user_type,
      userId: cred.user_id,
      reason: "not_verified",
    });
    return { verified: false };
  }

  // Update counter and last_used_at
  await query(
    `UPDATE webauthn_credentials
     SET counter = $1, last_used_at = NOW()
     WHERE credential_id = $2`,
    [verification.authenticationInfo.newCounter, cred.credential_id],
  );

  auditWebAuthnEvent({
    action: "authentication_verify",
    outcome: "success",
    userType: cred.user_type,
    userId: cred.user_id,
  });

  return {
    verified: true,
    user: { userType: cred.user_type, userId: cred.user_id },
    credentialId: cred.credential_id,
  };
}

// ── Credential Management ───────────────────────────────────────────

export async function listUserPasskeys(params: {
  userType: UserType;
  userId: string;
}): Promise<Array<{
  id: string;
  deviceName: string;
  createdAt: string;
  lastUsedAt: string | null;
}>> {
  const result = await query<{
    id: string;
    device_name: string;
    created_at: Date;
    last_used_at: Date | null;
  }>(
    `SELECT id, device_name, created_at, last_used_at
     FROM webauthn_credentials
     WHERE user_type = $1 AND user_id = $2
     ORDER BY created_at DESC`,
    [params.userType, params.userId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    deviceName: row.device_name,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
  }));
}

export async function deletePasskey(params: {
  userType: UserType;
  userId: string;
  credentialDbId: string;
}): Promise<boolean> {
  const result = await query(
    `DELETE FROM webauthn_credentials
     WHERE id = $1 AND user_type = $2 AND user_id = $3`,
    [params.credentialDbId, params.userType, params.userId],
  );
  const deleted = (result as { rowCount?: number }).rowCount ?? 0;

  if (deleted > 0) {
    auditWebAuthnEvent({
      action: "credential_deleted",
      outcome: "success",
      userType: params.userType,
      userId: params.userId,
      metadata: { credentialDbId: params.credentialDbId },
    });
  }

  return deleted > 0;
}

export async function userHasPasskeys(params: {
  userType: UserType;
  userId: string;
}): Promise<boolean> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM webauthn_credentials
     WHERE user_type = $1 AND user_id = $2`,
    [params.userType, params.userId],
  );
  return Number(result.rows[0]?.count || 0) > 0;
}
