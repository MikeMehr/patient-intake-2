/**
 * Can this booking actually be billed to MSP?
 *
 * A new patient books online by typing their own health card number into a public form. Nobody
 * checks it before the visit happens, so a typo becomes a chart with a wrong PHN, a claim MSP
 * rejects, and a visit the clinic works for free. The BC PHN carries a mod-11 check digit, which
 * catches essentially every single-digit typo and transposition — so the number can be checked at
 * the moment it is typed, while the patient is still there to fix it.
 *
 * This is the booking-time gate. It is deliberately stricter than
 * {@link import("./msp-eligibility").describeMspEligibility}, which only *describes* coverage for a
 * physician reading an SMS: this one decides whether the booking proceeds at all. It runs in the
 * browser (before the OSCAR chart is created) and again on the server (so a hand-rolled request
 * cannot skip it), which is why it stays pure — no database, no OSCAR client.
 *
 * Only a valid BC PHN passes. An out-of-province card is a real card but not MSP coverage, and
 * private pay, travel insurance and uninsured are not MSP at all — every one of those goes to the
 * clinic by email rather than into a slot on the strength of a public form.
 *
 * `reason` is written for the patient, not for staff: it says what to do about it, and it never
 * echoes the number back.
 */

import { isValidBcPhn, normalizeCard } from "./health-card";
import { toProvinceCode } from "@/lib/province-code";

/** Why a card was turned away — the caller picks the wording around it, not the verdict. */
export type BookingCardProblem =
  | "non-msp"
  | "missing"
  | "province"
  | "out-of-province"
  | "invalid";

export type BookingCardGate =
  | { ok: true }
  | { ok: false; problem: BookingCardProblem; reason: string };

const PASS: BookingCardGate = { ok: true };

/**
 * The coverage half of the gate, on its own: can this kind of coverage self-book at all?
 *
 * Split out because the form has to answer it the moment the patient picks a coverage type, with no
 * card number in hand — and a check that wants a number will call every MSP patient "card missing"
 * and bar the one path that is meant to work. Says nothing about the number itself; that is
 * {@link checkBookingHealthCard}, run against the field on submit.
 */
export function checkBookingCoverageType(coverageType: string): BookingCardGate {
  if (coverageType === "EXISTING_OSCAR_PATIENT") return PASS;
  if (coverageType === "CANADIAN_HEALTH_CARD") return PASS;
  return {
    ok: false,
    problem: "non-msp",
    reason: "Online booking is for patients with valid BC MSP coverage.",
  };
}

/**
 * Decide whether a booking's stated coverage is good enough to let the patient book themselves.
 *
 * Self-booking is for MSP-covered patients. Private pay, travel insurance and uninsured all mean
 * money changes hands, which is a conversation with the clinic rather than something to settle by
 * filling in a public form — those go to the clinic by email, same as a card that doesn't check out.
 *
 * A patient already on the chart is never this gate's business: whatever coverage the clinic
 * recorded stands, and the booking form does not re-ask.
 */
export function checkBookingHealthCard(input: {
  coverageType: string;
  province?: string | null;
  healthCardNumber?: string | null;
}): BookingCardGate {
  const coverage = checkBookingCoverageType(input.coverageType);
  if (!coverage.ok) return coverage;
  if (input.coverageType !== "CANADIAN_HEALTH_CARD") return PASS;

  const card = normalizeCard(input.healthCardNumber || "");
  if (!card) {
    return {
      ok: false,
      problem: "missing",
      reason: "Please enter your health card number (PHN).",
    };
  }

  // The province came from a dropdown the patient actually picked from, so a blank is a broken
  // submission rather than "probably local" — never quietly read as BC, because that would run a
  // BC check digit against another province's card.
  const code = toProvinceCode(input.province);
  if (!code) {
    return {
      ok: false,
      problem: "province",
      reason: "Please select the province or territory that issued your health card.",
    };
  }

  if (code !== "BC") {
    return {
      ok: false,
      problem: "out-of-province",
      reason: "This clinic bills BC MSP, and the health card you entered was issued outside BC.",
    };
  }

  if (!isValidBcPhn(card)) {
    return {
      ok: false,
      problem: "invalid",
      reason:
        /^\d+$/.test(card) && card.length !== 10
          ? `A BC Personal Health Number is 10 digits — you entered ${card.length}.`
          : "That is not a valid BC Personal Health Number.",
    };
  }

  return PASS;
}

/**
 * What the patient should do about it. Most failures are a typo, so the fix comes first — telling
 * someone to email the clinic over a mistyped digit costs the clinic a booking it could have had.
 */
export const BOOKING_CARD_FIX_HINT =
  "Please check the number on your card and try again.";

/**
 * Which sentences belong under a rejected card. Shared so the browser (which renders the address as
 * a mailto link) and the API (which can only return a string) say the same thing.
 */
export type BookingCardAdvice = {
  reason: string;
  /** Offer the retype hint — false when there is nothing to retype. */
  showFixHint: boolean;
  /** Offer the email route — false while the patient simply hasn't filled the form in yet. */
  showContact: boolean;
  /** Lead-in for the contact sentence, hedged only where a retry might still succeed. */
  contactLeadIn: string;
};

export function bookingCardAdvice(gate: {
  problem: BookingCardProblem;
  reason: string;
}): BookingCardAdvice {
  switch (gate.problem) {
    case "invalid":
      // Almost always a typo, so lead with "try again" and keep email as the second option.
      return {
        reason: gate.reason,
        showFixHint: true,
        showContact: true,
        contactLeadIn: "If the number is correct, please",
      };
    case "out-of-province":
    case "non-msp":
      // A real card, or none at all — either way nothing to retype. The clinic decides.
      return {
        reason: gate.reason,
        showFixHint: false,
        showContact: true,
        contactLeadIn: "Please",
      };
    default:
      // missing / province: the form isn't finished. Sending someone to email the clinic because
      // they haven't typed their number yet would be absurd.
      return {
        reason: gate.reason,
        showFixHint: false,
        showContact: false,
        contactLeadIn: "Please",
      };
  }
}

/**
 * The same advice as one string, for API responses.
 *
 * Falls back to "contact the clinic" when no address is on file rather than naming one clinic's
 * address in another clinic's error message.
 */
export function bookingCardMessage(
  gate: { problem: BookingCardProblem; reason: string },
  clinicEmail?: string | null,
): string {
  const advice = bookingCardAdvice(gate);
  const parts = [advice.reason];
  if (advice.showFixHint) parts.push(BOOKING_CARD_FIX_HINT);
  if (advice.showContact) {
    const addr = (clinicEmail || "").trim();
    parts.push(
      addr
        ? `${advice.contactLeadIn} email the clinic at ${addr} to book this appointment.`
        : `${advice.contactLeadIn} contact the clinic to book this appointment.`,
    );
  }
  return parts.join(" ");
}
