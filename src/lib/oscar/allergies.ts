/**
 * Write patient-reported allergies into the OSCAR chart's Allergies module.
 *
 * OSCAR's REST AllergyService is read-only (getCurrentAllergies is its only method,
 * verified on the live server), so this goes through the clinic's standalone bridge
 * (op=add_allergies) — the same service, path, and secret as pharmacy linking and
 * MSP eligibility. The bridge splits the free text on commas/semicolons and inserts
 * each item as a Custom Allergy entry marked "Patient-reported at online booking".
 */

import { postToBridge } from "./pharmacy";

// The booking response never waits on OSCAR being healthy: this runs after the
// appointment is committed and is purely an annotation on the chart.
const ADD_ALLERGIES_TIMEOUT_MS = 8000;

export async function addPatientReportedAllergies(
  orgId: string,
  demographicNo: string,
  allergiesText: string,
): Promise<{ ok: true; added: number } | { ok: false; error: string }> {
  const result = await postToBridge(
    orgId,
    { op: "add_allergies", demographicNo, allergies: allergiesText },
    ADD_ALLERGIES_TIMEOUT_MS,
  );
  if (!("ok" in result)) {
    return { ok: false, error: result.error };
  }
  const added = Array.isArray(result.json.added) ? result.json.added.length : 0;
  return { ok: true, added };
}
