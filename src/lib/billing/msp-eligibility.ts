/**
 * One-line MSP verdict for a booking, written for a physician reading a text message.
 *
 * This answers "will this visit bill to MSP, or do I need to collect payment?" at a glance. It is
 * a coverage summary, not a claim decision: the real gate is checkHealthCard() at billing time
 * against the card on the chart. What the patient typed into a public form is never authoritative,
 * so nothing here says "eligible" unless the number actually passes the BC PHN check digit.
 *
 * Kept free of PHI beyond the verdict itself — the card number is deliberately never returned, so
 * a PHN cannot end up in an SMS.
 */

import { checkHealthCard } from "@/lib/billing/health-card";
import { toProvinceCode } from "@/lib/province-code";

/**
 * The card OSCAR already holds for a returning patient, read straight off the chart.
 *
 * `hcType` is OSCAR's own `hc_type` column, passed through exactly as stored — including blank,
 * which checkHealthCard() reads as BC. Normalizing it here would make the verdict disagree with
 * what the day-billing sweep decides about the very same chart.
 */
export type ChartCard = {
  hin?: string | null;
  hcType?: string | null;
};

/**
 * Summarize what the patient's stated coverage means for MSP.
 *
 * @returns A short lowercase phrase to drop after "MSP: " — never empty.
 */
export function describeMspEligibility(input: {
  coverageType: string;
  province?: string | null;
  healthCardNumber?: string | null;
  /**
   * The card on the OSCAR chart, for a returning patient the form never asks for one. Omit it (or
   * pass null) when the chart could not be read — that is not the same as a chart with no card.
   */
  chartCard?: ChartCard | null;
}): string {
  switch (input.coverageType) {
    case "PRIVATE_PAY":
      return "no - private pay";
    case "TRAVEL_INSURANCE":
      return "no - travel insurance";
    case "UNINSURED":
      return "no - uninsured";
    case "EXISTING_OSCAR_PATIENT":
      // The booking form does not re-ask an existing patient for their card, so the chart is the
      // only source — and the caller goes and reads it. Without it, say so rather than implying
      // the coverage was checked.
      return describeChartCard(input.chartCard);
    case "CANADIAN_HEALTH_CARD":
      break;
    default:
      return "unknown";
  }

  const card = (input.healthCardNumber || "").trim();
  if (!card) return "card not provided";

  const code = toProvinceCode(input.province);
  // An unrecognized province is NOT quietly treated as BC here. checkHealthCard() defaults blank to
  // BC because most existing charts carry no hc_type, but this input came from a dropdown the
  // patient actually picked from — a blank means something went wrong, not "local patient".
  if (!code) return "unverified - province not stated";

  const check = checkHealthCard(card, code);
  if (check.ok) return "eligible";
  if (code !== "BC") return `out of province (${code})`;
  return `unverified - ${toGsm7(check.reason ?? "card failed validation")}`;
}

/**
 * Verdict for a returning patient, from the card already on their OSCAR chart.
 *
 * This is a card check, not a coverage check: it says whether the chart carries a health card MSP
 * will accept on a claim, which is the same standard applied to a card a new patient types in. It
 * does not ask MSP whether the patient's coverage is in force today — nothing in this app talks to
 * Teleplan.
 *
 * A null chartCard means the chart could not be read at all (OSCAR down, or not connected for this
 * clinic), which is a different thing from a chart with no card on it. Only the first falls back
 * to the original "see chart".
 */
function describeChartCard(chartCard: ChartCard | null | undefined): string {
  if (!chartCard) return "see chart";
  // Straight to checkHealthCard rather than through the province dropdown path above: this input
  // is OSCAR's own hc_type, and its blank-means-BC rule is the one billing will apply.
  const check = checkHealthCard(chartCard.hin ?? "", chartCard.hcType ?? null);
  if (check.ok) return "eligible (chart)";
  return toGsm7(check.reason ?? "card on chart failed validation");
}

/**
 * checkHealthCard writes its reasons for a web page and uses em dashes. A single non-GSM-7
 * character flips the entire SMS to UCS-2, which drops the segment size from 160 to 70 — so the
 * dash is folded to ASCII rather than passed through.
 */
function toGsm7(reason: string): string {
  return reason.replace(/[\u2010-\u2015\u2212]/g, "-");
}
