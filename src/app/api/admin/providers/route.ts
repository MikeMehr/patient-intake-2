/**
 * POST /api/admin/providers - Create provider (super admin only)
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { hashPassword, validatePassword } from "@/lib/auth";
import { randomBytes } from "crypto";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

function generateSlug(firstName: string, lastName: string, clinicName: string): string {
  const clean = (str: string) => str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const first = clean(firstName);
  const last = clean(lastName);
  const clinic = clean(clinicName);
  const random = randomBytes(4).toString("hex");
  return `${first}-${last}-${clinic}-${random}`;
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "super_admin") {
      status = 401;
      const res = NextResponse.json(
        { error: "Unauthorized - Super admin access required" },
        { status }
      );
      logRequestMeta("/api/admin/providers", requestId, status, Date.now() - started);
      return res;
    }

    const body = await request.json();
    const { firstName, lastName, clinicName, username, password, email, phone, organizationId } = body;

    if (!firstName || !lastName || !clinicName || !username || !password) {
      status = 400;
      const res = NextResponse.json(
        { error: "First name, last name, clinic name, username, and password are required" },
        { status }
      );
      logRequestMeta("/api/admin/providers", requestId, status, Date.now() - started);
      return res;
    }

    // Validate password complexity
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      status = 400;
      const res = NextResponse.json(
        { error: passwordValidation.error },
        { status }
      );
      logRequestMeta("/api/admin/providers", requestId, status, Date.now() - started);
      return res;
    }

    // Check if username already exists
    const existingUser = await query<{ id: string }>(
      `SELECT id FROM physicians WHERE username = $1`,
      [username.toLowerCase().trim()]
    );

    if (existingUser.rows.length > 0) {
      status = 409;
      const res = NextResponse.json(
        { error: "Username already exists" },
        { status }
      );
      logRequestMeta("/api/admin/providers", requestId, status, Date.now() - started);
      return res;
    }

    // Check if email already exists (if provided)
    if (email) {
      const existingEmail = await query<{ id: string }>(
        `SELECT id FROM physicians WHERE email = $1`,
        [email.toLowerCase().trim()]
      );

      if (existingEmail.rows.length > 0) {
        status = 409;
        const res = NextResponse.json(
          { error: "Email already registered" },
          { status }
        );
        logRequestMeta("/api/admin/providers", requestId, status, Date.now() - started);
        return res;
      }
    }

    // Verify organization exists if provided
    if (organizationId) {
      const orgCheck = await query<{ id: string }>(
        `SELECT id FROM organizations WHERE id = $1`,
        [organizationId]
      );

      if (orgCheck.rows.length === 0) {
        status = 404;
        const res = NextResponse.json(
          { error: "Organization not found" },
          { status }
        );
        logRequestMeta("/api/admin/providers", requestId, status, Date.now() - started);
        return res;
      }
    }

    // Generate unique slug
    let uniqueSlug = generateSlug(firstName, lastName, clinicName);
    let attempts = 0;
    while (attempts < 10) {
      const slugCheck = await query<{ id: string }>(
        `SELECT id FROM physicians WHERE unique_slug = $1`,
        [uniqueSlug]
      );
      if (slugCheck.rows.length === 0) {
        break;
      }
      uniqueSlug = generateSlug(firstName, lastName, clinicName);
      attempts++;
    }

    if (attempts >= 10) {
      status = 500;
      const res = NextResponse.json(
        { error: "Failed to generate unique slug. Please try again." },
        { status }
      );
      logRequestMeta("/api/admin/providers", requestId, status, Date.now() - started);
      return res;
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Insert provider
    const result = await query<{ id: string }>(
      `INSERT INTO physicians (first_name, last_name, clinic_name, username, password_hash, unique_slug, email, phone, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        firstName.trim(),
        lastName.trim(),
        clinicName.trim(),
        username.toLowerCase().trim(),
        passwordHash,
        uniqueSlug,
        email ? email.toLowerCase().trim() : null,
        phone ? phone.trim() : null,
        organizationId || null,
      ]
    );

    const providerId = result.rows[0].id;

    const res = NextResponse.json({
      success: true,
      provider: {
        id: providerId,
        username: username.toLowerCase().trim(),
        uniqueSlug,
      },
      intakeFormUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/intake/${uniqueSlug}`,
    });
    logRequestMeta("/api/admin/providers", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[admin/providers] POST Error");
    const res = NextResponse.json(
      { error: "Internal server error" },
      { status }
    );
    logRequestMeta("/api/admin/providers", requestId, status, Date.now() - started);
    return res;
  }
}

