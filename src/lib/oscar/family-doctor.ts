/**
 * Fill the OSCAR Master Record's Referral Doctor field (demographic.family_doctor)
 * with the family-doctor name a patient typed at online booking.
 *
 * The REST demographics create maps DemographicTo1.familyDoctor in its converter but
 * the value doesn't survive to the row (verified live 2026-09-05: a create sending it
 * produced the empty `<rdohip></rdohip><rd></rd>` skeleton), so this goes through the
 * clinic's bridge (op=set_family_doctor) right after chart creation. The bridge writes
 * only when the field is empty, so a name staff entered is never overwritten.
 */

import { postToBridge } from "./pharmacy";

const SET_FAMILY_DOCTOR_TIMEOUT_MS = 8000;

export async function setOscarFamilyDoctor(
  orgId: string,
  demographicNo: string,
  familyDoctorName: string,
): Promise<{ ok: true; updated: boolean } | { ok: false; error: string }> {
  const result = await postToBridge(
    orgId,
    { op: "set_family_doctor", demographicNo, familyDoctor: familyDoctorName },
    SET_FAMILY_DOCTOR_TIMEOUT_MS,
  );
  if (!("ok" in result)) {
    return { ok: false, error: result.error };
  }
  return { ok: true, updated: result.json.updated === true };
}
