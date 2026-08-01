/**
 * GET /api/booking/[clinicSlug]/pharmacy-search?q=
 * Public route — typeahead over the clinic's mirrored OSCAR pharmacy directory.
 *
 * Security controls:
 *  - Requires an active booking hold cookie (same gate as lookup-patient / create-oscar-patient).
 *    The data itself is a public business directory, but every sibling booking route gates this
 *    way and an open endpoint is a free scraping target.
 *  - Returns pharmacy business details only — never patient data.
 *
 * `directoryEmpty` lets the client fall straight through to free text on a cold table instead of
 * showing the patient an empty dropdown or an error about a sync they know nothing about.
 */

import { after, NextRequest, NextResponse } from "next/server";
import { getClinicBySlug } from "@/lib/booking-store";
import { query } from "@/lib/db";
import {
  getPharmacyDirectoryState,
  searchPharmacyDirectory,
  shouldRefreshDirectory,
  syncPharmacyDirectoryForOrg,
} from "@/lib/pharmacy-directory";

export const runtime = "nodejs";

const HOLD_COOKIE = "booking_hold_key";
const MAX_QUERY_LEN = 100;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clinicSlug: string }> },
) {
  try {
    const { clinicSlug } = await params;

    const sessionKey = req.cookies.get(HOLD_COOKIE)?.value;
    if (!sessionKey) {
      return NextResponse.json(
        { error: "No active booking hold. Please select a time slot first." },
        { status: 403 },
      );
    }

    const clinic = await getClinicBySlug(clinicSlug);
    if (!clinic || !clinic.settings?.onlineBookingEnabled) {
      return NextResponse.json({ error: "Clinic not found" }, { status: 404 });
    }

    const holdCheck = await query<{ id: string }>(
      `SELECT s.id FROM appointment_slots s
       WHERE s.organization_id = $1
         AND s.status = 'HELD'
         AND s.held_session_key = $2
         AND s.held_until > NOW()
       LIMIT 1`,
      [clinic.id, sessionKey],
    );
    if (holdCheck.rows.length === 0) {
      return NextResponse.json(
        { error: "Hold not found or expired. Please select a time slot again." },
        { status: 403 },
      );
    }

    const q = String(req.nextUrl.searchParams.get("q") ?? "")
      .trim()
      .slice(0, MAX_QUERY_LEN);

    const state = await getPharmacyDirectoryState(clinic.id);

    // Self-heal a missing or stale mirror without making the patient wait for it. after() rather
    // than a floating promise: Azure tears down the request context as soon as we respond, which
    // would kill an un-awaited sync mid-transaction.
    if (shouldRefreshDirectory(state)) {
      after(async () => {
        try {
          await syncPharmacyDirectoryForOrg(clinic.id);
        } catch (err) {
          console.error("[pharmacy-search] background directory sync failed:", err);
        }
      });
    }

    if (state.count === 0) {
      return NextResponse.json({ pharmacies: [], directoryEmpty: true });
    }

    const pharmacies = await searchPharmacyDirectory(clinic.id, q);
    return NextResponse.json({
      pharmacies: pharmacies.map((p) => ({
        id: p.oscarPharmacyId,
        name: p.name,
        address: p.address ?? "",
        city: p.city ?? "",
        phone: p.phone ?? "",
        fax: p.fax ?? "",
      })),
      directoryEmpty: false,
    });
  } catch (err) {
    console.error("[pharmacy-search] Unhandled error:", err);
    // Fail soft: the picker treats this like an empty directory and offers free text, so a broken
    // search can never stop someone from booking.
    return NextResponse.json({ pharmacies: [], directoryEmpty: true }, { status: 200 });
  }
}
