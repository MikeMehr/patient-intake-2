/**
 * GET /api/org/providers/[id] - Get provider details
 * PUT /api/org/providers/[id] - Update provider (org admin only)
 * DELETE /api/org/providers/[id] - Delete provider (org admin only)
 *
 * PUT and DELETE stay org_admin-only on purpose — they set another provider's password
 * and destroy accounts, which manages_org_booking deliberately does not confer. Because
 * PUT is also where that grant is toggled, a physician holding it cannot widen it.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getOrgAdminContext } from "@/lib/auth-helpers";
import { query } from "@/lib/db";
import { hashPassword, validatePassword } from "@/lib/auth";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import {
  assessPasswordAgainstBreaches,
  BREACHED_PASSWORD_ERROR,
  BREACH_CHECK_UNAVAILABLE_ERROR,
} from "@/lib/password-breach";
import { CONTEXT_PASSWORD_ERROR, isPasswordContextWordSafe } from "@/lib/password-context";

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: string }).code === "23505"
    : false;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const session = await getCurrentSession();
    const orgContext = await getOrgAdminContext(session);
    if (!orgContext) {
      status = 401;
      const res = NextResponse.json(
        { error: "Unauthorized - Booking Dashboard access required" },
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
      manages_org_booking: boolean;
      oscar_provider_no: string | null;
      doxy_room_url: string | null;
      video_visits_disabled: boolean;
    }>(
      `SELECT id, first_name, last_name, clinic_name, username, email, phone, unique_slug, organization_id, mfa_enabled, manages_org_booking, oscar_provider_no, doxy_room_url, video_visits_disabled
       FROM physicians
       WHERE id = $1 AND organization_id = $2`,
      [id, orgContext.organizationId]
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
        managesOrgBooking: provider.manages_org_booking,
        oscarProviderNo: provider.oscar_provider_no,
        doxyRoomUrl: provider.doxy_room_url,
        videoVisitsDisabled: provider.video_visits_disabled === true,
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
    // Deliberately org_admin-only (see file header): this sets another provider's
    // password_hash, and it is where manages_org_booking itself is toggled.
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
    const { firstName, lastName, clinicName, email, phone, password, mfaEnabled, managesOrgBooking, oscarProviderNo, doxyRoomUrl, videoVisitsDisabled } = body;

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
      const normalizedEmail = email ? email.toLowerCase().trim() : null;
      if (normalizedEmail) {
        const duplicateEmail = await query<{ id: string }>(
          `SELECT id FROM physicians WHERE email = $1 AND id <> $2`,
          [normalizedEmail, id]
        );
        if (duplicateEmail.rows.length > 0) {
          status = 409;
          const res = NextResponse.json(
            { error: "Email already registered" },
            { status }
          );
          logRequestMeta("/api/org/providers/[id]", requestId, status, Date.now() - started);
          return res;
        }
      }
      updates.push(`email = $${paramIndex++}`);
      values.push(normalizedEmail);
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
    if (managesOrgBooking !== undefined) {
      // No session purge on revoke. getOrgAdminContext reads this column live, so clearing it
      // denies the next /api/org/* request on its own — and killing the provider's sessions
      // here would end an in-progress AI Scribe recording to revoke a booking permission.
      updates.push(`manages_org_booking = $${paramIndex++}`);
      values.push(Boolean(managesOrgBooking));
    }
    if (oscarProviderNo !== undefined) {
      // OSCAR provider numbers are numeric; store digits only, allow clearing.
      const cleaned = oscarProviderNo ? String(oscarProviderNo).replace(/\D/g, "") : "";
      updates.push(`oscar_provider_no = $${paramIndex++}`);
      values.push(cleaned || null);
    }

    if (doxyRoomUrl !== undefined) {
      // Only https, and only a doxy.me host. This value is emailed to patients and written onto
      // the OSCAR day sheet, so an unvalidated string here would be a way to point patients at an
      // arbitrary site from a message they have every reason to trust.
      const raw = doxyRoomUrl ? String(doxyRoomUrl).trim() : "";
      let cleaned: string | null = null;
      if (raw) {
        try {
          // People type "doxy.me/drsomebody", because that is what Doxy shows them and what
          // they say out loud. Requiring a scheme would reject the obvious input, so add one —
          // and upgrade http, since Doxy is https-only and a downgrade here would be silently
          // worse than the thing the user meant.
          const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
          const u = new URL(withScheme);
          if (u.protocol === "http:") u.protocol = "https:";
          const okHost = /(^|\.)doxy\.me$/i.test(u.hostname);
          if (!okHost) {
            status = 400;
            const res = NextResponse.json(
              { error: "The Doxy link must be an https://doxy.me/… address." },
              { status },
            );
            logRequestMeta("/api/org/providers/[id]", requestId, status, Date.now() - started);
            return res;
          }
          cleaned = u.toString();
        } catch {
          status = 400;
          const res = NextResponse.json({ error: "That isn't a valid link." }, { status });
          logRequestMeta("/api/org/providers/[id]", requestId, status, Date.now() - started);
          return res;
        }
      }
      updates.push(`doxy_room_url = $${paramIndex++}`);
      values.push(cleaned);
    }

    if (videoVisitsDisabled !== undefined) {
      // Deliberately independent of doxy_room_url. Clearing the room would also stop video, but
      // it would erase the address rather than record the decision, and a room pasted back later
      // would silently undo it.
      updates.push(`video_visits_disabled = $${paramIndex++}`);
      values.push(Boolean(videoVisitsDisabled));
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
    if (isUniqueConstraintError(error)) {
      status = 409;
      const res = NextResponse.json(
        { error: "Email already registered" },
        { status }
      );
      logRequestMeta("/api/org/providers/[id]", requestId, status, Date.now() - started);
      return res;
    }
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
    // Deliberately org_admin-only (see file header): this destroys a colleague's account.
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

