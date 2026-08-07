/**
 * Health-card rules for MSP claims.
 *
 * OSCAR stores the card as typed into `demographic.hin` (varchar(12)) but a claim carries it in
 * `billingmaster.phn`, which is varchar(10). An Ontario card is 10 digits followed by a 2-letter
 * version code, so it does not fit — the letters have to come off before the number reaches a
 * claim. That is the whole reason this module exists.
 *
 * This file is the executable spec. The enforcement copy runs inside OSCAR (mymd.billing.DayBilling)
 * because the decision has to be made on the box, next to the chart. Keep the two in step: the
 * tests here are what the Java port is checked against.
 */

/** Weights applied to digits 2..9 of a BC PHN. */
const BC_PHN_WEIGHTS = [2, 4, 8, 5, 10, 9, 7, 3];

/** OSCAR's own placeholder for "no PHN recorded"; never a real card. */
const PLACEHOLDER = "0000000000";

export type HealthCardProvince = "BC" | "ON" | "OTHER";

export type HealthCardCheck = {
  /** True only when the number is safe to put on a claim without a human looking at it. */
  ok: boolean;
  /** Exactly 10 digits when ok; "" otherwise. This is what goes into billingmaster.phn. */
  claimHin: string;
  /** The Ontario 2-letter version code when present, else "". Captured, never discarded. */
  versionCode: string;
  province: HealthCardProvince;
  /** Present when !ok — shown verbatim to the physician on the results page. */
  reason?: string;
};

/** Strip the separators people type. Does NOT remove letters — those are meaningful. */
export function normalizeCard(raw: string): string {
  return (raw || "").replace(/[\s-]/g, "").toUpperCase();
}

/**
 * BC PHN check digit (mod 11 over digits 2..9).
 *
 * Verified against this clinic's own data: every PHN on a claim MSP accepted passes, and the only
 * failures are OSCAR's 0000000000 placeholder.
 */
export function isValidBcPhn(phn: string): boolean {
  if (!/^\d{10}$/.test(phn)) return false;
  if (phn[0] !== "9") return false;
  let sum = 0;
  for (let i = 0; i < BC_PHN_WEIGHTS.length; i++) {
    sum += Number(phn[i + 1]) * BC_PHN_WEIGHTS[i];
  }
  const remainder = sum % 11;
  // A remainder of 0 or 1 cannot produce a single-digit check value, so no such PHN is issued.
  if (remainder === 0 || remainder === 1) return false;
  return 11 - remainder === Number(phn[9]);
}

/** Ontario health numbers carry a Luhn (mod 10) check digit over the 10 digits. */
export function isValidOnHin(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Blank counts as BC. Most charts on this box carry no hc_type at all, and this is a BC clinic —
 * reading blank as "other province" would mean nothing ever auto-bills. The check digit still has
 * to pass, so a card that is not actually a BC PHN cannot slip through on this default.
 */
export function normalizeProvince(hcType: string | null | undefined): HealthCardProvince {
  const t = (hcType || "").trim().toUpperCase();
  if (t === "ON") return "ON";
  if (t === "" || t === "BC") return "BC";
  return "OTHER";
}

/**
 * Decide what a card means for billing.
 *
 * Only BC cards that pass the checksum come back ok:true — those are the ones the day sweep bills
 * without asking. Everything else is returned with a reason and needs the physician to tick it.
 *
 * The Ontario rule is a split, not a strip: the trailing letters are the version code and are
 * returned in `versionCode` rather than thrown away.
 *
 * Letters are removed ONLY for Ontario. A BC PHN containing a letter is a data-entry error, and
 * quietly reshaping it into a plausible 10-digit number would file a claim against a stranger's PHN.
 */
export function checkHealthCard(
  rawHin: string | null | undefined,
  hcType: string | null | undefined,
): HealthCardCheck {
  const province = normalizeProvince(hcType);
  const card = normalizeCard(rawHin || "");

  if (!card || card === PLACEHOLDER) {
    return { ok: false, claimHin: "", versionCode: "", province, reason: "No health card number on the chart" };
  }

  if (province === "ON") {
    const m = /^(\d{10})([A-Z]{0,2})$/.exec(card);
    if (!m) {
      return {
        ok: false,
        claimHin: "",
        versionCode: "",
        province,
        reason: "Ontario card is not 10 digits plus an optional 2-letter version code",
      };
    }
    const [, digits, version] = m;
    return {
      ok: false, // out of province — prepared, but never auto-billed
      claimHin: digits,
      versionCode: version,
      province,
      reason: isValidOnHin(digits)
        ? "Ontario card — out of province, confirm before billing"
        : "Ontario card fails its check digit",
    };
  }

  if (province === "OTHER") {
    return {
      ok: false,
      claimHin: /^\d{10}$/.test(card) ? card : "",
      versionCode: "",
      province,
      reason: "Out-of-province card — confirm before billing",
    };
  }

  // BC
  if (/[A-Z]/.test(card)) {
    return {
      ok: false,
      claimHin: "",
      versionCode: "",
      province,
      reason: "BC PHN contains letters — check the chart",
    };
  }
  if (!isValidBcPhn(card)) {
    return {
      ok: false,
      claimHin: /^\d{10}$/.test(card) ? card : "",
      versionCode: "",
      province,
      reason:
        card.length === 10
          ? "BC PHN fails its check digit"
          : `BC PHN is ${card.length} digits, expected 10`,
    };
  }
  return { ok: true, claimHin: card, versionCode: "", province };
}
