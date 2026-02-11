/**
 * Authentication utilities
 * Password hashing, session management, and authentication helpers
 */

import bcrypt from "bcrypt";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { logDebug } from "@/lib/secure-logger";

const SALT_ROUNDS = 12;

// Lazy getter — defers the check to request time so the module can be imported
// during the Next.js build phase without crashing.
function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is required");
  }
  return secret;
}
const SESSION_COOKIE_NAME = "physician_session";
const SESSION_MAX_AGE = 30 * 60 * 1000; // 30 minutes

export type UserType = "super_admin" | "org_admin" | "provider";

export interface UserSession {
  userId: string; // Generic user ID (can be physician_id, org_user_id, or super_admin_id)
  userType: UserType;
  username: string;
  firstName: string;
  lastName: string;
  organizationId?: string | null; // For org admins and providers
  clinicName?: string; // For providers (legacy support)
  clinicAddress?: string | null;
  expiresAt: number;
}

// Legacy interface for backward compatibility
export interface PhysicianSession extends UserSession {
  physicianId: string; // Alias for userId when userType is 'provider'
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate a secure session token
 */
function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Create a session and set cookie
 * Supports all user types: super_admin, org_admin, provider
 */
export async function createSession(
  userId: string,
  userType: UserType,
  username: string,
  firstName: string,
  lastName: string,
  organizationId?: string | null,
  clinicName?: string,
  clinicAddress?: string | null
): Promise<string> {
  const token = generateSessionToken();
  const expiresAt = Date.now() + SESSION_MAX_AGE;

  const session: UserSession = {
    userId,
    userType,
    username,
    firstName,
    lastName,
    organizationId: organizationId || null,
    clinicName: clinicName || undefined,
    clinicAddress: clinicAddress ?? null,
    expiresAt,
  };

  // Store session in database FIRST
  // (We do this before setting the cookie so if DB fails, we don't set a bad cookie)
  const cookieStore = await cookies();

  // Store session data in database
  try {
    const { query } = await import("./db");
    await query(
      `INSERT INTO physician_sessions (token, user_id, user_type, organization_id, physician_id, expires_at, session_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (token) DO UPDATE SET expires_at = $6, session_data = $7, user_id = $2, user_type = $3, organization_id = $4`,
      [
        token,
        userId,
        userType,
        organizationId || null,
        userType === "provider" ? userId : null, // Keep physician_id for backward compatibility
        new Date(expiresAt),
        JSON.stringify(session)
      ]
    );
    
    // Set cookie AFTER successful database storage
    cookieStore.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE / 1000,
      path: "/",
    });
  } catch (error) {
    console.error("[auth/createSession] Error storing session in database:", error);
    // Don't set cookie if session storage fails
    throw error; // Re-throw so login fails if session can't be created
  }

  return token;
}

/**
 * Legacy createSession for providers (backward compatibility)
 */
export async function createProviderSession(
  physicianId: string,
  username: string,
  firstName: string,
  lastName: string,
  clinicName: string,
  clinicAddress?: string | null,
  organizationId?: string | null
): Promise<string> {
  return createSession(
    physicianId,
    "provider",
    username,
    firstName,
    lastName,
    organizationId,
    clinicName,
    clinicAddress
  );
}

/**
 * Verify session token and return session data
 */
export async function verifySession(
  token: string
): Promise<UserSession | null> {
  if (!token) return null;

  const { query } = await import("./db");
  const result = await query<{
    user_id: string | null;
    user_type: string | null;
    organization_id: string | null;
    physician_id: string | null;
    expires_at: Date;
    session_data: string | UserSession; // JSONB can be string or object
  }>(
    `SELECT user_id, user_type, organization_id, physician_id, expires_at, session_data
     FROM physician_sessions
     WHERE token = $1 AND expires_at > NOW()`,
    [token]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  
  // PostgreSQL JSONB columns return objects directly, not strings
  // Check if it's already an object or needs parsing
  let session: UserSession;
  if (typeof row.session_data === 'string') {
    session = JSON.parse(row.session_data) as UserSession;
  } else {
    session = row.session_data as UserSession;
  }

  // Migrate old sessions to new format if needed
  if (!session.userType && row.user_type) {
    session.userType = row.user_type as UserType;
  }
  if (!session.userId && (row.user_id || row.physician_id)) {
    session.userId = row.user_id || row.physician_id || "";
  }
  if (session.organizationId === undefined && row.organization_id) {
    session.organizationId = row.organization_id;
  }

  // Check if session is expired
  if (session.expiresAt < Date.now()) {
    // Clean up expired session
    await query("DELETE FROM physician_sessions WHERE token = $1", [token]);
    return null;
  }

  return session;
}

/**
 * Get current session from cookie
 */
export async function getCurrentSession(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    logDebug("[auth/getCurrentSession] Cookie check", {
      hasCookie: !!token,
      cookieName: SESSION_COOKIE_NAME,
      tokenLength: token?.length,
    });

    if (!token) {
      logDebug("[auth/getCurrentSession] No session cookie found");
      return null;
    }

    const session = await verifySession(token);
    logDebug("[auth/getCurrentSession] Session verification", {
      hasSession: !!session,
      userType: session?.userType,
    });
    return session;
  } catch (error) {
    console.error("[auth/getCurrentSession] Error:", error);
    return null;
  }
}

/**
 * Legacy getCurrentSession for providers (backward compatibility)
 */
export async function getCurrentProviderSession(): Promise<PhysicianSession | null> {
  const session = await getCurrentSession();
  if (!session || session.userType !== "provider") {
    return null;
  }
  // Convert to legacy format
  return {
    ...session,
    physicianId: session.userId,
  } as PhysicianSession;
}

/**
 * Delete session (logout)
 */
export async function deleteSession(token: string): Promise<void> {
  const { query } = await import("./db");
  await query("DELETE FROM physician_sessions WHERE token = $1", [token]);

  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

/**
 * Validate password complexity
 */
export function validatePassword(password: string): {
  valid: boolean;
  error?: string;
} {
  if (password.length < 8) {
    return { valid: false, error: "Password must be at least 8 characters" };
  }

  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, error: "Password must contain at least one letter" };
  }

  if (!/[0-9]/.test(password)) {
    return { valid: false, error: "Password must contain at least one number" };
  }

  return { valid: true };
}
