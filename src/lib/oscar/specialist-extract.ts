/**
 * Extract a specialist's details from free text pasted off a PathwaysBC profile page.
 *
 * Serves the OSCAR "Add Specialist" page (mymd/addSpecialist.jsp): a physician pastes the profile
 * text, the model reads it, and what comes back prefills OSCAR's own Add Specialist form for the
 * physician to review. The model never writes to OSCAR — the physician edits every field and the
 * JSP performs the write from inside their own OSCAR session.
 *
 * The rules that make an extraction usable are OSCAR's, not the model's, so they are applied here
 * after the fact rather than asked of the model: referralNo must be blank or exactly 6 digits
 * (normalizeReferralNo), the salutation dropdown accepts five exact values, and the specialty is
 * translated to this clinic's service name through the same alias table the sync pipeline uses
 * (oscarServiceNameFor) — imported from specialist-sync-plan.ts, not copied.
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { normalizeReferralNo, oscarServiceNameFor } from "@/lib/oscar/specialist-sync-plan";

/** OSCAR's salutation dropdown accepts exactly these — same set normalizeSalutation guards in
 *  specialist-sync-plan.ts, redeclared because it is private there. */
const VALID_SALUTATIONS = ["Dr.", "Mr.", "Mrs.", "Miss", "Ms."] as const;

export type SpecialistConfidence = "high" | "medium" | "low";

/** One specialist as extracted and normalized. Every field may be "" — the form starts blank there. */
export type ExtractedSpecialist = {
  salutation: string;
  firstName: string;
  lastName: string;
  proLetters: string;
  /** The specialty as the paste stated it, e.g. "Dermatology". */
  specialty: string;
  /** Verbatim MSP number from the paste, letters and all (e.g. "Q4978"). */
  mspNumber: string;
  /** OSCAR's referral number rule applied to mspNumber: 6 digits, or "". */
  referralNo: string;
  phone: string;
  fax: string;
  email: string;
  address: string;
  website: string;
  /** This clinic's OSCAR service name for the specialty, via the alias table. */
  suggestedOscarService: string;
  /** Prefill for OSCAR's annotation field; carries an MSP number that couldn't become a referralNo. */
  annotation: string;
  /** Short quote from the paste locating the name and specialty. Shown on screen. */
  evidence: string;
};

export type SpecialistExtraction = {
  specialists: ExtractedSpecialist[];
  confidence: SpecialistConfidence;
  /** Why specialists is empty, when it is ("model_error", "content_filter", ...). */
  reason: string;
};

/** Returned whenever there is nothing usable — the page falls back to a blank manual form. */
export function emptyExtraction(reason = ""): SpecialistExtraction {
  return { specialists: [], confidence: "low", reason };
}

/** A paste is one profile, occasionally a couple side by side — never a roster. */
const MAX_SPECIALISTS = 5;

/** PathwaysBC profiles are a screenful; anything bigger is a mispaste, and a bound on prompt size. */
export const MAX_TEXT_CHARS = 20_000;

const SYSTEM_PROMPT = [
  "You are reading text a physician copied from PathwaysBC (a British Columbia specialist referral",
  "directory) so a specialist can be added to the clinic's EMR referral list.",
  "",
  "The paste is one specialist's profile: name, specialty, an MSP billing number, and an Office",
  "Information block with phone, fax, email and the clinic address. It also carries site noise —",
  "lines like 'Accepting consultative referrals', 'Incorrect Information? Let us know', 'This",
  "practice opened at this location in ...', wait times, languages spoken. Ignore the noise.",
  "",
  "Fill in only what the text states plainly. Every field may be left empty. An empty field costs",
  "the physician a moment of typing; a wrong one ends up on referral letters. Never invent or",
  "complete a value.",
  "",
  "Rules:",
  "- specialists: one entry per specialist the paste is actually about. A phrase like 'with 5",
  "  others' counts colleagues at the same clinic — they are NOT specialists to extract. Most",
  "  pastes yield exactly one entry.",
  "- salutation: 'Dr.' only when the text uses it; otherwise empty.",
  "- firstName / lastName: the specialist's given name(s) and family name, split. A multi-word",
  "  family name stays whole in lastName.",
  "- proLetters: professional credentials if listed ('MD, FRCPC'), else empty.",
  "- specialty: the specialty exactly as the profile states it, e.g. 'Dermatology'.",
  "- mspNumber: the MSP or billing number exactly as printed, including any letters ('Q4978').",
  "  Not a phone number, not a postal code.",
  "- phone: the office phone number. A bare number in the Office Information block is the phone.",
  "  Never a number labelled Fax.",
  "- fax: only a number the text labels Fax.",
  "- email: an email address for the office. Prefer one marked okay for patient use; a private",
  "  physician-office-only address is second choice. Empty if none.",
  "- address: the clinic name and full street address, on one line. Drop a trailing 'with N",
  "  others'. Do not put a website, hours, parking notes or an email into the address.",
  "- website: a URL for the clinic or specialist, else empty.",
  "- evidence: quote at most 15 words from the paste showing the name and specialty. Quote, do",
  "  not paraphrase.",
  "- confidence: high when the paste is a clean profile naming everything plainly; medium when",
  "  fields had to be picked out of clutter; low when the text barely resembles a profile.",
].join("\n");

/**
 * Azure's `strict` mode requires every property in `required` and `additionalProperties: false`
 * on every object, so "absent" is expressed as an empty string rather than a missing key.
 */
export function buildSpecialistSchema() {
  const str = { type: "string" } as const;
  return {
    type: "json_schema" as const,
    json_schema: {
      name: "specialist_profile",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["specialists", "confidence"],
        properties: {
          specialists: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "salutation",
                "firstName",
                "lastName",
                "proLetters",
                "specialty",
                "mspNumber",
                "phone",
                "fax",
                "email",
                "address",
                "website",
                "evidence",
              ],
              properties: {
                salutation: { type: "string", enum: [...VALID_SALUTATIONS, ""] },
                firstName: str,
                lastName: str,
                proLetters: str,
                specialty: str,
                mspNumber: str,
                phone: str,
                fax: str,
                email: str,
                address: str,
                website: str,
                evidence: str,
              },
            },
          },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
  };
}

export function buildSpecialistMessages(text: string): ChatCompletionMessageParam[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: ["Pasted profile text:", text.slice(0, MAX_TEXT_CHARS)].join("\n") },
  ];
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * A full NANP number (area code and exchange both [2-9]xx) is reformatted the way OSCAR's own form
 * does (604-247-9378). Anything else passes through as typed: phone is REQUIRED by AddSpecialist.do,
 * so blanking an odd-but-real number would block the add — the physician sees and fixes it instead.
 * Same shape rule as senderFaxNumber in src/lib/fax/triage.ts.
 */
function normalizePhone(value: unknown): string {
  const raw = cleanText(value, 40);
  if (!raw) return "";
  let digits = raw.replace(/[^0-9]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
}

const EMAIL_RE = /^[\w.+-]+@[\w-]+\.[\w.-]+$/;

/** Same suffix PathwaysBC appends to shared clinic addresses — see stripTrailingOthersSuffix in
 *  src/lib/pathways/profile-parse.ts. */
const OTHERS_SUFFIX_RE = /\s+with\s+\d+\s+others?\.?$/i;
/** The model sometimes carries the trailing history sentence into the address. */
const OPENED_SENTENCE_RE = /\s*This practice opened at this location[^.]*\.?\s*$/i;

function cleanAddress(value: unknown): string {
  return cleanText(value, 255).replace(OTHERS_SUFFIX_RE, "").replace(OPENED_SENTENCE_RE, "").trim();
}

/**
 * Prefill for OSCAR's annotation field. An MSP number that can't be a referral number (alphanumeric,
 * wrong length) would otherwise be lost — OSCAR silently no-ops on anything but blank-or-6-digits —
 * so it rides along here in text form.
 */
function buildAnnotation(mspNumber: string, referralNo: string): string {
  const base = "Added from PathwaysBC.";
  if (mspNumber && !referralNo) {
    return `${base} MSP # ${mspNumber} (not a 6-digit referral number — left blank in OSCAR).`;
  }
  return base;
}

/**
 * Re-check the model's answer. `strict` schemas make a malformed reply unlikely, but everything
 * here lands in a referral directory physicians fax real charts to, so it is checked rather than
 * trusted — and the physician reviews every field on screen before OSCAR is touched.
 */
export function validateSpecialistResponse(raw: unknown): SpecialistExtraction {
  if (!raw || typeof raw !== "object") return emptyExtraction("model_output_invalid");
  const obj = raw as Record<string, unknown>;

  const allowedSalutations = new Set<string>(VALID_SALUTATIONS);
  const rawList = Array.isArray(obj.specialists) ? obj.specialists.slice(0, MAX_SPECIALISTS) : [];
  const seen = new Set<string>();
  const specialists: ExtractedSpecialist[] = [];

  for (const entry of rawList) {
    const s = (entry ?? {}) as Record<string, unknown>;
    const lastName = cleanText(s.lastName, 30);
    if (!lastName) continue; // nothing OSCAR could file the record under

    const firstName = cleanText(s.firstName, 30);
    const key = `${firstName}|${lastName}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const specialty = cleanText(s.specialty, 60);
    const mspNumber = cleanText(s.mspNumber, 20);
    const referralNo = normalizeReferralNo(mspNumber);
    const salutation = cleanText(s.salutation, 10);
    const email = cleanText(s.email, 100);

    specialists.push({
      salutation: allowedSalutations.has(salutation) ? salutation : "",
      firstName,
      lastName,
      proLetters: cleanText(s.proLetters, 60),
      specialty,
      mspNumber,
      referralNo,
      phone: normalizePhone(s.phone),
      fax: normalizePhone(s.fax),
      email: EMAIL_RE.test(email) ? email : "",
      address: cleanAddress(s.address),
      website: cleanText(s.website, 120),
      suggestedOscarService: specialty ? oscarServiceNameFor(specialty) : "",
      annotation: buildAnnotation(mspNumber, referralNo),
      evidence: cleanText(s.evidence, 200),
    });
  }

  const confidence: SpecialistConfidence =
    obj.confidence === "high" || obj.confidence === "medium" || obj.confidence === "low"
      ? obj.confidence
      : "low";

  if (!specialists.length) return emptyExtraction("nothing_extracted");
  return { specialists, confidence, reason: "" };
}
