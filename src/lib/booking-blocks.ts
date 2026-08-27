/**
 * Per-patient online-booking blocks, keyed (organization_id, oscar_demographic_no).
 *
 * Rows are written by the OSCAR Master Chart's "Block online booking" button via
 * /api/emr/oscar/booking-block and read by the public booking flow: lookup-patient
 * turns a match into a "please email the clinic" screen, and confirm re-checks
 * server-side because the client-supplied demographicNo is otherwise untrusted.
 */

import { query } from "@/lib/db";

function normalizeDemographicNo(demographicNo: string): string | null {
  const no = String(demographicNo ?? "").trim();
  return /^\d{1,10}$/.test(no) ? no : null;
}

export async function isBookingBlocked(
  orgId: string,
  demographicNo: string
): Promise<boolean> {
  const no = normalizeDemographicNo(demographicNo);
  if (!no) return false;
  const res = await query<{ id: string }>(
    `SELECT id FROM booking_blocks
     WHERE organization_id = $1 AND oscar_demographic_no = $2
     LIMIT 1`,
    [orgId, no]
  );
  return res.rows.length > 0;
}

export async function setBookingBlock(
  orgId: string,
  demographicNo: string,
  blockedBy?: string | null
): Promise<boolean> {
  const no = normalizeDemographicNo(demographicNo);
  if (!no) return false;
  await query(
    `INSERT INTO booking_blocks (organization_id, oscar_demographic_no, blocked_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (organization_id, oscar_demographic_no) DO NOTHING`,
    [orgId, no, blockedBy ?? null]
  );
  return true;
}

export async function clearBookingBlock(
  orgId: string,
  demographicNo: string
): Promise<boolean> {
  const no = normalizeDemographicNo(demographicNo);
  if (!no) return false;
  await query(
    `DELETE FROM booking_blocks
     WHERE organization_id = $1 AND oscar_demographic_no = $2`,
    [orgId, no]
  );
  return true;
}
