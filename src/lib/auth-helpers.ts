/**
 * Authentication helpers for querying different user types
 * Used by login routes to authenticate super admins, org admins, and providers
 */

import { query } from "./db";
import type { UserType } from "./auth";

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
  }>(
    `SELECT id, username, password_hash, email, first_name, last_name
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
  }>(
    `SELECT id, organization_id, username, password_hash, email, first_name, last_name, role
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
  }>(
    `SELECT id, organization_id, username, password_hash, email, first_name, last_name, clinic_name, clinic_address, unique_slug, phone
     FROM physicians
     WHERE username = $1`,
    [username.toLowerCase().trim()]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
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
