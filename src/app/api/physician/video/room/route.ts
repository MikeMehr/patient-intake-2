/**
 * The signed-in provider's Doxy waiting room.
 *
 * All that is left of the video API. Doxy has no API and no per-visit rooms — one permanent room
 * per provider, and the patient waits in it until admitted — so there is nothing to create, no
 * token to mint and no visit to look up. This just answers "which room is mine?".
 *
 * Kept as an endpoint rather than reading the column in the page because /physician/video is
 * reached from OSCAR, where the only thing the day sheet can tell us is an appointment number.
 * The provider comes from the session either way.
 */

import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { query } from "@/lib/db";

export async function GET() {
  const session = await getCurrentSession();
  if (!session?.organizationId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // An org_admin's userId is a row in organization_users, not physicians — they have no room of
  // their own, and saying so is more useful than a confusing empty state.
  if (session.userType !== "provider") {
    return NextResponse.json({
      doxyRoomUrl: null,
      physicianName: null,
      reason: "not_a_provider",
    });
  }

  const physicianId = getEffectivePhysicianId(session);
  const res = await query<{
    doxy_room_url: string | null;
    first_name: string;
    last_name: string;
  }>(
    `SELECT doxy_room_url, first_name, last_name
       FROM physicians
      WHERE id = $1 AND organization_id = $2`,
    [physicianId, session.organizationId],
  );
  const row = res.rows[0];
  if (!row) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  return NextResponse.json({
    doxyRoomUrl: row.doxy_room_url,
    physicianName: `Dr. ${row.first_name} ${row.last_name}`.trim(),
    reason: row.doxy_room_url ? null : "no_room_set",
  });
}
