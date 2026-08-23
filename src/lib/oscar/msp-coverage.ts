/**
 * Real-time MSP coverage check (Teleplan E45), via the clinic's OSCAR bridge.
 *
 * A BC PHN can pass its check digit and still not be covered — the card is real but the patient
 * let their MSP lapse. Only MSP itself can answer that, and the clinic's Teleplan credentials
 * live on the OSCAR box, so the bridge beside OSCAR (op=check_elig) runs the same E45 inquiry
 * OSCAR's own "Check Eligibility" button sends and returns just the eligibility fields.
 *
 * Callers treat every failure as UNAVAILABLE and fall back to the card-format verdict — a
 * booking must never hinge on Teleplan being up.
 */

import { postToBridge } from "@/lib/oscar/pharmacy";

export type MspCoverageCheck =
  | { status: "ELIGIBLE" }
  | { status: "NOT_ELIGIBLE"; coverageEndDate: string | null; coverageEndReason: string | null }
  | { status: "UNAVAILABLE"; detail: string };

const PHN_RE = /^\d{10}$/;
const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The patient's booking response waits on this, so it gets a hard budget well under the bridge's
 * own 25 s Teleplan timeout. A confirmed answer normally arrives in 2–4 s.
 */
const E45_TIMEOUT_MS = 12_000;

/** Ask MSP whether `phn` is eligible today. `dob` is the birthdate MSP verifies the PHN against. */
export async function checkMspCoverage(
  orgId: string,
  args: { phn: string; dob: string },
): Promise<MspCoverageCheck> {
  if (!PHN_RE.test(args.phn) || !DOB_RE.test(args.dob)) {
    return { status: "UNAVAILABLE", detail: "phn or dob malformed" };
  }

  const res = await postToBridge(orgId, { op: "check_elig", phn: args.phn, dob: args.dob }, E45_TIMEOUT_MS);
  if (!("ok" in res)) {
    return { status: "UNAVAILABLE", detail: res.error };
  }

  const elig = String(res.json.eligOnDos ?? "").toUpperCase();
  if (elig === "YES") return { status: "ELIGIBLE" };
  if (elig === "NO") {
    return {
      status: "NOT_ELIGIBLE",
      coverageEndDate: String(res.json.coverageEndDate ?? "").trim() || null,
      coverageEndReason: String(res.json.coverageEndReason ?? "").trim() || null,
    };
  }
  // MSP answered but without an ELIG_ON_DOS line — treat as unknown, never as a verdict.
  return { status: "UNAVAILABLE", detail: "no ELIG_ON_DOS in E45 response" };
}
