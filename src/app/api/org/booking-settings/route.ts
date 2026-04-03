/**
 * GET  /api/org/booking-settings — Retrieve booking settings for the logged-in org
 * PATCH /api/org/booking-settings — Update booking settings (upsert)
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getBookingSettingsByOrgId, upsertBookingSettings } from "@/lib/booking-store";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

function generateOrgSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 48);
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "org_admin" || !session.organizationId) {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/org/booking-settings", requestId, status, Date.now() - started);
      return res;
    }

    // Also fetch org slug so the UI can show the booking URL preview
    const orgRow = await query<{ name: string; slug: string | null }>(
      "SELECT name, slug FROM organizations WHERE id = $1",
      [session.organizationId],
    );
    const org = orgRow.rows[0];

    const settings = await getBookingSettingsByOrgId(session.organizationId);

    const res = NextResponse.json({
      orgName: org?.name ?? "",
      orgSlug: org?.slug ?? null,
      settings,
    });
    logRequestMeta("/api/org/booking-settings", requestId, status, Date.now() - started);
    return res;
  } catch (err) {
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/org/booking-settings", requestId, status, Date.now() - started);
    return res;
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "org_admin" || !session.organizationId) {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/org/booking-settings", requestId, status, Date.now() - started);
      return res;
    }

    const body = await request.json();

    // Handle org slug update
    if (body.orgSlug !== undefined) {
      const slug = String(body.orgSlug)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "")
        .replace(/^-|-$/g, "")
        .substring(0, 48);

      if (slug) {
        // Check uniqueness
        const existing = await query<{ id: string }>(
          "SELECT id FROM organizations WHERE slug = $1 AND id != $2",
          [slug, session.organizationId],
        );
        if (existing.rows.length > 0) {
          status = 409;
          const res = NextResponse.json({ error: "This booking URL is already taken. Please choose another." }, { status });
          logRequestMeta("/api/org/booking-settings", requestId, status, Date.now() - started);
          return res;
        }
        await query("UPDATE organizations SET slug = $1 WHERE id = $2", [slug, session.organizationId]);
      }
    }

    // Handle per-physician booking toggle
    if (Array.isArray(body.physicianBookingToggles)) {
      for (const { physicianId, enabled } of body.physicianBookingToggles) {
        if (typeof physicianId === "string" && typeof enabled === "boolean") {
          await query(
            `UPDATE physicians SET online_booking_enabled = $1
             WHERE id = $2 AND organization_id = $3`,
            [enabled, physicianId, session.organizationId],
          );
        }
      }
    }

    // Update booking settings
    await upsertBookingSettings(session.organizationId, {
      onlineBookingEnabled: body.onlineBookingEnabled,
      publicBookingStart: body.publicBookingStart,
      publicBookingEnd: body.publicBookingEnd,
      enforceBookingWindow: body.enforceBookingWindow,
      slotIntervalMinutes: body.slotIntervalMinutes,
      healthCardRequired: body.healthCardRequired,
      showBlockedSlots: body.showBlockedSlots,
      cancellationPolicy: body.cancellationPolicy,
      bookingInstructions: body.bookingInstructions,
      timezone: body.timezone,
    });

    const updatedSettings = await getBookingSettingsByOrgId(session.organizationId);
    const orgRow = await query<{ name: string; slug: string | null }>(
      "SELECT name, slug FROM organizations WHERE id = $1",
      [session.organizationId],
    );
    const org = orgRow.rows[0];

    const res = NextResponse.json({
      orgName: org?.name ?? "",
      orgSlug: org?.slug ?? null,
      settings: updatedSettings,
    });
    logRequestMeta("/api/org/booking-settings", requestId, status, Date.now() - started);
    return res;
  } catch (err) {
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/org/booking-settings", requestId, status, Date.now() - started);
    return res;
  }
}
