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
 * Summarize what the patient's stated coverage means for MSP.
 *
 * @returns A short lowercase phrase to drop after "MSP: " — never empty.
 */
export function describeMspEligibility(input: {
  coverageType: string;
  province?: string | null;
  healthCardNumber?: string | null;
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
      // only source. Say so rather than implying the coverage was checked.
      return "see chart";
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
  // checkHealthCard writes its reasons for a web page and uses em dashes. A single non-GSM-7
  // character flips the entire SMS to UCS-2, which drops the segment size from 160 to 70 — so the
  // dash is folded to ASCII rather than passed through.
  const reason = (check.reason ?? "card failed validation").replace(
    /[\u2010-\u2015\u2212]/g,
    "-",
  );
  return `unverified - ${reason}`;
}
