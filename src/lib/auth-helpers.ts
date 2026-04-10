/**
 * Authentication helpers for querying different user types
 * Used by login routes to authenticate super admins, org admins, and providers
 */

import { query } from "./db";
import type { UserType, UserSession } from "./auth";

/**
 * Get super admin by username
 */
export async function getSuperAdminByUsername(username: string) {
  const result = await query<{
    id: string;
    username: string;
    password_hash: string;
    email: string;
    first_name: string;
    last_name: string;
    mfa_enabled: boolean;
  }>(
    `SELECT id, username, password_hash, email, first_name, last_name, mfa_enabled
     FROM super_admin_users
     WHERE username = $1`,
    [username.toLowerCase().trim()]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

/**
 * Get organization admin by username
 */
export async function getOrgAdminByUsername(username: string) {
  const result = await query<{
    id: string;
    organization_id: string;
    username: string;
    password_hash: string;
    email: string;
    first_name: string;
    last_name: string;
    role: string;
    mfa_enabled: boolean;
  }>(
    `SELECT id, organization_id, username, password_hash, email, first_name, last_name, role, mfa_enabled
     FROM organization_users
     WHERE username = $1`,
    [username.toLowerCase().trim()]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

/**
 * Get provider (physician) by username
 */
export async function getProviderByUsername(username: string) {
  const result = await query<{
    id: string;
    organization_id: string | null;
    username: string;
    password_hash: string;
    email: string | null;
    first_name: string;
    last_name: string;
    clinic_name: string;
    clinic_address: string | null;
    unique_slug: string;
    phone: string | null;
    mfa_enabled: boolean;
  }>(
    `SELECT id, organization_id, username, password_hash, email, first_name, last_name, clinic_name, clinic_address, unique_slug, phone, mfa_enabled
     FROM physicians
     WHERE username = $1`,
    [username.toLowerCase().trim()]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

export async function getAuthUserByTypeAndId(userType: UserType, userId: string) {
  if (userType === "super_admin") {
    const result = await query<{
      id: string;
      username: string;
      first_name: string;
      last_name: string;
      email: string;
      mfa_enabled: boolean;
    }>(
      `SELECT id, username, first_name, last_name, email, mfa_enabled
       FROM super_admin_users
       WHERE id = $1`,
      [userId],
    );
    return result.rows[0] || null;
  }

  if (userType === "org_admin") {
    const result = await query<{
      id: string;
      username: string;
      first_name: string;
      last_name: string;
      email: string;
      organization_id: string;
      mfa_enabled: boolean;
    }>(
      `SELECT id, username, first_name, last_name, email, organization_id, mfa_enabled
       FROM organization_users
       WHERE id = $1`,
      [userId],
    );
    return result.rows[0] || null;
  }

  const result = await query<{
    id: string;
    username: string;
    first_name: string;
    last_name: string;
    email: string | null;
    organization_id: string | null;
    clinic_name: string;
    clinic_address: string | null;
    unique_slug: string;
    mfa_enabled: boolean;
  }>(
    `SELECT id, username, first_name, last_name, email, organization_id, clinic_name, clinic_address, unique_slug, mfa_enabled
     FROM physicians
     WHERE id = $1`,
    [userId],
  );
  return result.rows[0] || null;
}

/**
 * Get provider (physician) by ID
 */
export async function getProviderById(physicianId: string) {
  const result = await query<{
    id: string;
    organization_id: string | null;
    username: string;
    email: string | null;
    first_name: string;
    last_name: string;
    clinic_name: string;
    clinic_address: string | null;
    unique_slug: string;
    phone: string | null;
    mfa_enabled: boolean;
  }>(
    `SELECT id, organization_id, username, email, first_name, last_name, clinic_name, clinic_address, unique_slug, phone, mfa_enabled
     FROM physicians
     WHERE id = $1`,
    [physicianId]
  );
  return result.rows[0] || null;
}

/**
 * Get assistant (provider_assistants) by username
 */
export async function getAssistantByUsername(username: string) {
  const result = await query<{
    id: string;
    physician_id: string;
    username: string;
    password_hash: string;
    email: string | null;
    first_name: string;
    last_name: string;
    is_active: boolean;
    mfa_enabled: boolean;
  }>(
    `SELECT id, physician_id, username, password_hash, email, first_name, last_name, is_active, mfa_enabled
     FROM provider_assistants
     WHERE username = $1`,
    [username.toLowerCase().trim()]
  );
  return result.rows[0] || null;
}

/**
 * Returns the effective physician ID for data scoping.
 * For assistant sessions, this is the linked physician's ID.
 * For regular provider sessions, this is the provider's own ID.
 */
export function getEffectivePhysicianId(session: UserSession): string {
  return session.linkedPhysicianId ?? session.userId;
}

/**
 * Returns true if this session belongs to an assistant (not a direct provider login).
 */
export function isAssistantSession(session: UserSession): boolean {
  return !!session.linkedPhysicianId;
}

/**
 * Get organization by ID
 */
export async function getOrganizationById(organizationId: string) {
  const result = await query<{
    id: string;
    name: string;
    email: string;
    business_address: string;
    phone: string | null;
    fax: string | null;
    is_active: boolean;
  }>(
    `SELECT id, name, email, business_address, phone, fax, is_active
     FROM organizations
     WHERE id = $1`,
    [organizationId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

/**
 * Verify organization ownership (for org admins)
 */
export async function verifyOrganizationOwnership(
  userId: string,
  organizationId: string,
  userType: UserType
): Promise<boolean> {
  if (userType === "super_admin") {
    return true; // Super admins have access to all organizations
  }

  if (userType === "org_admin") {
    const result = await query<{ id: string }>(
      `SELECT id FROM organization_users
       WHERE id = $1 AND organization_id = $2`,
      [userId, organizationId]
    );
    return result.rows.length > 0;
  }

  if (userType === "provider") {
    const result = await query<{ id: string }>(
      `SELECT id FROM physicians
       WHERE id = $1 AND organization_id = $2`,
      [userId, organizationId]
    );
    return result.rows.length > 0;
  }

  return false;
}
