/**
 * GET /api/org/providers/[id] - Get provider details (org admin only)
 * PUT /api/org/providers/[id] - Update provider (org admin only)
 * DELETE /api/org/providers/[id] - Delete provider (org admin only)
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { hashPassword, validatePassword } from "@/lib/auth";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import {
  assessPasswordAgainstBreaches,
  BREACHED_PASSWORD_ERROR,
  BREACH_CHECK_UNAVAILABLE_ERROR,
} from "@/lib/password-breach";
import { CONTEXT_PASSWORD_ERROR, isPasswordContextWordSafe } from "@/lib/password-context";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "org_admin" || !session.organizationId) {
      status = 401;
      const res = NextResponse.json(
        { error: "Unauthorized - Organization admin access required" },
        { status }
      );
      logRequestMeta("/api/org/providers/[id]", requestId, status, Date.now() - started);
      return res;
    }

    const { id } = await params;

    // Verify provider belongs to organization
    const result = await query<{
      id: string;
      first_name: string;
      last_name: string;
      clinic_name: string;
      username: string;
      email: string | null;
      phone: string | null;
      unique_slug: string;
      organization_id: string | null;
      mfa_enabled: boolean;
    }>(
      `SELECT id, first_name, last_name, clinic_name, username, email, phone, unique_slug, organization_id, mfa_enabled
       FROM physicians
       WHERE id = $1 AND organization_id = $2`,
      [id, session.organizationId]
    );

    if (result.rows.length === 0) {
      status = 404;
      const res = NextResponse.json(
        { error: "Provider not found or access denied" },
        { status }
      );
      logRequestMeta("/api/org/providers/[id]", requestId, status, Date.now() - started);
      return res;
    }

    const provider = result.rows[0];

    const res = NextResponse.json({
      provider: {
        id: provider.id,
        firstName: provider.first_name,
        lastName: provider.last_name,
        clinicName: provider.clinic_name,
        username: provider.username,
        email: provider.email,
        phone: provider.phone,
        uniqueSlug: provider.unique_slug,
        organizationId: provider.organization_id,
        mfaEnabled: provider.mfa_enabled,
      },
    });
    logRequestMeta("/api/org/providers/[id]", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[org/providers/[id]] GET Error");
    const res = NextResponse.json(
      { error: "Internal server error" },
      { status }
    );
    logRequestMeta("/api/org/providers/[id]", requestId, status, Date.now() - started);
    return res;
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "org_admin" || !session.organizationId) {
      status = 401;
      const res = NextResponse.json(
        { error: "Unauthorized - Organization admin access required" },
        { status }
      );
      logRequestMeta("/api/org/providers/[id]", requestId, status, Date.now() - started);
      return res;
    }

    const { id } = await params;
    const body = await request.json();
    const { firstName, lastName, clinicName, email, phone, password, mfaEnabled } = body;

    // Verify provider belongs to organization
    const existingProvider = await query<{ id: string; organization_id: string | null }>(
      `SELECT id, organization_id FROM physicians WHERE id = $1 AND organization_id = $2`,
      [id, session.organizationId]
    );

    if (existingProvider.rows.length === 0) {
      status = 404;
      const res = NextResponse.json(
        { error: "Provider not found or access denied" },
        { status }
      );
      logRequestMeta("/api/org/providers/[id]", requestId, status, Date.now() - started);
      return res;
    }

    // Update password if provided
    let passwordHash: string | undefined;
    if (password) {
      const passwordValidation = validatePassword(password);
      if (!passwordValidation.valid) {
        status = 400;
        const res = NextResponse.json(
          { error: passwordValidation.error },
          { status }
        );
        logRequestMeta("/api/org/providers/[id]", requestId, status, Date.now() - started);
        return res;
      }
      if (!isPasswordContextWordSafe(password)) {
        status = 400;
        const res = NextResponse.json(
          { error: CONTEXT_PASSWORD_ERROR },
          { status },
        );
        logRequestMeta("/api/org/providers/[id]", requestId, status, Date.now() - started);
        return res;
      }
      const breachAssessment = await assessPasswordAgainstBreaches(password);
      if (breachAssessment.unavailable && !breachAssessment.failOpen) {
        status = 503;
        const res = NextResponse.json(
          { error: BREACH_CHECK_UNAVAILABLE_ERROR },
          { status },
        );
        logRequestMeta("/api/org/providers/[id]", requestId, status, Date.now() - started);
        return res;
      }
      if (breachAssessment.breached) {
        status = 400;
        const res = NextResponse.json(
          { error: BREACHED_PASSWORD_ERROR },
          { status },
        );
        logRequestMeta("/api/org/providers/[id]", requestId, status, Date.now() - started);
        return res;
      }
      passwordHash = await hashPassword(password);
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (firstName) {
      updates.push(`first_name = $${paramIndex++}`);
      values.push(firstName.trim());
    }
    if (lastName) {
      updates.push(`last_name = $${paramIndex++}`);
      values.push(lastName.trim());
    }
    if (clinicName) {
      updates.push(`clinic_name = $${paramIndex++}`);
      values.push(clinicName.trim());
    }
    if (email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      values.push(email ? email.toLowerCase().trim() : null);
    }
    if (phone !== undefined) {
      updates.push(`phone = $${paramIndex++}`);
      values.push(phone ? phone.trim() : null);
    }
    if (passwordHash) {
      updates.push(`password_hash = $${paramIndex++}`);
      values.push(passwordHash);
    }
    if (mfaEnabled !== undefined) {
      updates.push(`mfa_enabled = $${paramIndex++}`);
      values.push(Boolean(mfaEnabled));
    }

    if (updates.length === 0) {
      status = 400;
      const res = NextResponse.json(
        { error: "No fields to update" },
        { status }
      );
        logRequestMeta("/api/org/providers/[id]", requestId, status, Date.now() - started);
      return res;
    }

    values.push(id, session.organizationId);
    await query(
      `UPDATE physicians SET ${updates.join(", ")} WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}`,
      values
    );
    if (passwordHash) {
      await query(`DELETE FROM physician_sessions WHERE physician_id = $1`, [id]);
    }

    const res = NextResponse.json({ success: true });
    logRequestMeta("/api/org/providers/[id]", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[org/providers/[id]] PUT Error");
    const res = NextResponse.json(
      { error: "Internal server error" },
      { status }
    );
    logRequestMeta("/api/org/providers/[id]", requestId, status, Date.now() - started);
    return res;
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "org_admin" || !session.organizationId) {
      status = 401;
      const res = NextResponse.json(
        { error: "Unauthorized - Organization admin access required" },
        { status }
      );
      logRequestMeta("/api/org/providers/[id]", requestId, status, Date.now() - started);
      return res;
    }

    const { id } = await params;

    // Verify provider belongs to organization
    const existingProvider = await query<{ id: string }>(
      `SELECT id FROM physicians WHERE id = $1 AND organization_id = $2`,
      [id, session.organizationId]
    );

    if (existingProvider.rows.length === 0) {
      status = 404;
      const res = NextResponse.json(
        { error: "Provider not found or access denied" },
        { status }
      );
      logRequestMeta("/api/org/providers/[id]", requestId, status, Date.now() - started);
      return res;
    }

    // Delete provider
    await query(`DELETE FROM physicians WHERE id = $1 AND organization_id = $2`, [id, session.organizationId]);

    const res = NextResponse.json({ success: true });
    logRequestMeta("/api/org/providers/[id]", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[org/providers/[id]] DELETE Error");
    const res = NextResponse.json(
      { error: "Internal server error" },
      { status }
    );
    logRequestMeta("/api/org/providers/[id]", requestId, status, Date.now() - started);
    return res;
  }
}

