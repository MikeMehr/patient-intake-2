/**
 * Read an incoming fax and suggest how OSCAR's Incoming Docs screen should be filled in.
 *
 * The model is handed OCR'd text and returns *what it read off the page* — a patient name, a date
 * of birth, a health number, the doctor the fax is addressed to. It never returns an OSCAR
 * `demographic_no` or `provider_no`. Those are resolved on the OSCAR box against its own tables,
 * which is what turns a misread name into a failed match instead of a document filed to the wrong
 * chart.
 *
 * Document type and class are carried in `json_schema` enums built from OSCAR's live
 * `ctl_doctype` / `ctl_doc_class` rows, so an off-list value is structurally impossible rather than
 * merely unlikely — the same approach `src/lib/billing/dx-suggest.ts` uses for diagnostic codes.
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

/** Sentinel for "the fax does not say" on the two enum fields. Never a real OSCAR value. */
export const UNKNOWN = "unknown";

/** An active provider in this OSCAR, offered so the model can recognise the addressee. */
export type FaxProvider = { name: string; mspNumber: string };

export type FaxConfidence = "high" | "medium" | "low";

/** Identifiers read off the fax. Every field may be "" — the box treats "" as "not stated". */
export type FaxPatientHint = {
  lastName: string;
  firstName: string;
  /** ISO `YYYY-MM-DD`, or "". */
  dateOfBirth: string;
  /** Digits only, province suffix stripped, or "". */
  phn: string;
  /** Where this person appears, e.g. "1" or "3-5". Blank when the model could not say. */
  pages: string;
};

export type FaxAddressee = {
  name: string;
  mspNumber: string;
};

export type FaxTriageSuggestion = {
  /** A value from OSCAR's ctl_doctype, or UNKNOWN. */
  documentType: string;
  /** A value from OSCAR's ctl_doc_class, or UNKNOWN. */
  documentClass: string;
  /** Short human title for the document, e.g. "Renal Ultrasound". May be "". */
  description: string;
  /** Date the study/report was performed, ISO `YYYY-MM-DD`, or "". Not the fax transmission date. */
  observationDate: string;
  /** Every distinct person the fax is about, in page order. Usually one; occasionally many. */
  patients: FaxPatientHint[];
  /**
   * True when the fax carries documents for more than one person.
   *
   * One transmission holding five patients' results is the one case where a confident match is
   * actively dangerous: filing it to the first patient misfiles the other four AND puts their
   * results in a stranger's chart. The caller must refuse to preselect anything when this is set.
   */
  multiPatient: boolean;
  /** The single patient, when there is exactly one. Empty fields otherwise — never a "best guess". */
  patient: FaxPatientHint;
  addressedTo: FaxAddressee;
  /** Clinic/hospital that sent the fax. Context for the physician; not used for matching. */
  senderFacility: string;
  /**
   * The sender's own fax number as read off the page — the number a reply would be faxed back to.
   * 10 digits, or "". Never one of the receiving clinic's own numbers (supplied in the request).
   */
  senderFaxNumber: string;
  /** 1-based page where that number was read, or 0 when unknown. */
  senderFaxPage: number;
  confidence: FaxConfidence;
  /** Short quote from the fax supporting the reading. Shown on screen; never logged. */
  evidence: string;
};

export function emptyPatient(): FaxPatientHint {
  return { lastName: "", firstName: "", dateOfBirth: "", phn: "", pages: "" };
}

/** Returned whenever there is nothing usable — bad OCR, model error, kill switch. */
export function emptySuggestion(): FaxTriageSuggestion {
  return {
    documentType: UNKNOWN,
    documentClass: UNKNOWN,
    description: "",
    observationDate: "",
    patients: [],
    multiPatient: false,
    patient: emptyPatient(),
    addressedTo: { name: "", mspNumber: "" },
    senderFacility: "",
    senderFaxNumber: "",
    senderFaxPage: 0,
    confidence: "low",
    evidence: "",
  };
}

/** OSCAR's description column is short, and a title longer than this is a summary, not a title. */
const MAX_DESCRIPTION = 60;

/** Faxes are a page or three. Well past any real one, and a bound on prompt size. */
const MAX_OCR_CHARS = 30_000;

/** A batch fax of this size is already a "split this by hand" answer; the exact count stops mattering. */
const MAX_PATIENTS = 20;

const SYSTEM_PROMPT = [
  "You are triaging a fax that has arrived at a British Columbia family medicine clinic, so that it",
  "can be filed into the correct patient's chart in an EMR.",
  "",
  "The text you are given came from OCR of a scanned fax. It will contain mistakes, broken columns",
  "and stray marks. Read what is actually there.",
  "",
  "Fill in only what the fax states plainly. Every field may be left empty. An empty field costs the",
  "physician a moment of typing; a confident wrong one files a medical document into a stranger's",
  "chart. When two readings are possible, leave the field empty.",
  "",
  "The text is marked up with --- PAGE n --- separators. Use them to say which pages each person",
  "appears on.",
  "",
  "Rules:",
  "- patients: EVERY distinct person the fax is about, in page order. Not the sender, not the",
  "  addressee, not a next of kin. A fax cover sheet often names clinic staff and doctors — none of",
  "  those is a patient.",
  "  One transmission often carries documents for several people (a batch of lab results, a stack of",
  "  letters). List them all. Do not merge two people, and do not list the same person twice because",
  "  their name is spelled differently on two pages — same health number means the same person.",
  "  Return an empty list if no patient is named.",
  "- pages: where that person appears, as '2' or '3-5'. Leave empty if you cannot tell.",
  "- phn: the BC Personal Health Number of that patient (also printed as PHN, Health #, MSP, or Care",
  "  Card). Digits only; drop any trailing province code. Never invent or complete a partial number.",
  "- dateOfBirth: the patient's date of birth. Do not confuse it with the collection date, the report",
  "  date, or the fax date. Output YYYY-MM-DD.",
  "- addressedTo: the doctor the fax is directed to — the 'To:', 'Attention:' or 'Dear Dr ...' line.",
  "  This is a doctor at the receiving clinic. The sending doctor is not the addressee.",
  "- senderFacility: the hospital, lab or clinic the fax came from.",
  "- senderFaxNumber: the fax number to reach the SENDER back — a pharmacy's fax on a refill",
  "  request, the 'From' fax on a cover sheet, the fax line in the sender's letterhead or footer.",
  "  A cover sheet usually carries TWO fax numbers: the one in the 'To' block is the RECEIVER's,",
  "  never the sender's, even when it is labelled 'Fax' — take the one from the 'From' line,",
  "  letterhead or footer instead. Prefer a number explicitly labelled 'Fax', 'Fax #' or",
  "  'Facsimile'. Never a number labelled Phone, Tel or Cell, never the patient's PHN, and NEVER",
  "  any number listed in the user message as belonging to the RECEIVING clinic. 10 digits, drop",
  "  a leading 1. Leave empty when unsure.",
  "- senderFaxPage: the page (per the --- PAGE n --- markers) where senderFaxNumber was read, as a",
  "  number. 0 when unknown or when senderFaxNumber is empty.",
  "- documentType and documentClass: choose from the supplied lists. Answer 'unknown' if none fits.",
  "- description: a short title a physician would recognise on a chart list, naming the study or",
  "  letter — 'Renal Ultrasound', 'Chest X-Ray', 'Cardiology Consultation'. Include the body part or",
  "  specialty when the fax gives it. Do not include the patient's name or the date.",
  `  At most ${MAX_DESCRIPTION} characters.`,
  "- observationDate: when the study was performed or the letter written, NOT when it was faxed.",
  "  Output YYYY-MM-DD. Leave empty if the fax gives only a transmission date.",
  "- confidence: high when the fax is clean and names patient and study plainly; medium when you had",
  "  to work through OCR damage; low when the page is fragmentary or mostly illegible.",
  "- evidence: quote at most 15 words from the fax showing where the patient and study came from.",
  "  Quote, do not paraphrase.",
].join("\n");

/**
 * JSON schema pinning documentType/documentClass to OSCAR's live lists.
 *
 * Azure's `strict` mode requires every property to appear in `required` and every object to set
 * `additionalProperties: false`, nested objects included — so "absent" is expressed as an empty
 * string rather than a missing key.
 */
export function buildFaxSchema(docTypes: string[], docClasses: string[]) {
  const str = { type: "string" } as const;
  return {
    type: "json_schema" as const,
    json_schema: {
      name: "fax_triage",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: [
          "documentType",
          "documentClass",
          "description",
          "observationDate",
          "patients",
          "addressedTo",
          "senderFacility",
          "senderFaxNumber",
          "senderFaxPage",
          "confidence",
          "evidence",
        ],
        properties: {
          documentType: { type: "string", enum: [...docTypes, UNKNOWN] },
          documentClass: { type: "string", enum: [...docClasses, UNKNOWN] },
          description: str,
          observationDate: str,
          patients: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["lastName", "firstName", "dateOfBirth", "phn", "pages"],
              properties: {
                lastName: str,
                firstName: str,
                dateOfBirth: str,
                phn: str,
                pages: str,
              },
            },
          },
          addressedTo: {
            type: "object",
            additionalProperties: false,
            required: ["name", "mspNumber"],
            properties: { name: str, mspNumber: str },
          },
          senderFacility: str,
          senderFaxNumber: str,
          senderFaxPage: { type: "integer" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          evidence: str,
        },
      },
    },
  };
}

export function buildFaxMessages(
  ocrText: string,
  docTypes: string[],
  docClasses: string[],
  providers: FaxProvider[],
  clinicFaxNumbers: string[] = [],
): ChatCompletionMessageParam[] {
  const roster = providers.length
    ? providers.map((p) => (p.mspNumber ? `${p.name} (MSP ${p.mspNumber})` : p.name)).join("\n")
    : "(none on file)";

  const clinicNumbersBlock = clinicFaxNumbers.length
    ? [
        "",
        "Numbers that belong to the RECEIVING clinic (these are never the sender's):",
        clinicFaxNumbers.join(", "),
      ]
    : [];

  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        "Permitted document types:",
        docTypes.join(", "),
        "",
        "Permitted document classes:",
        docClasses.join(", "),
        "",
        "Doctors at this clinic (a fax addressed to one of these is for them):",
        roster,
        ...clinicNumbersBlock,
        "",
        "OCR text of the fax:",
        ocrText.slice(0, MAX_OCR_CHARS),
      ].join("\n"),
    },
  ];
}

/** ISO date, and a real one — `2026-02-31` is a misread, not a date. */
function cleanDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!m) return "";
  const [, y, mo, d] = m;
  const date = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  // Round-trip catches overflow: JS turns 2026-02-31 into March 3 rather than rejecting it.
  if (
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() + 1 !== Number(mo) ||
    date.getUTCDate() !== Number(d)
  ) {
    return "";
  }
  return trimmed;
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Re-check the model's answer.
 *
 * `strict` schemas make an off-list type very unlikely, but this is the boundary between a language
 * model and a patient's chart, so it is checked rather than trusted. The OSCAR box checks again
 * when it resolves these identifiers against its own tables — this is the cheaper of the two
 * guards, not the last one.
 */
export function validateFaxResponse(
  raw: unknown,
  docTypes: string[],
  docClasses: string[],
): FaxTriageSuggestion {
  if (!raw || typeof raw !== "object") return emptySuggestion();
  const obj = raw as Record<string, unknown>;

  const typeAllowed = new Set(docTypes);
  const classAllowed = new Set(docClasses);

  const documentType = cleanText(obj.documentType, 40);
  const documentClass = cleanText(obj.documentClass, 60);

  const addressedRaw = (obj.addressedTo ?? {}) as Record<string, unknown>;

  // A health number identifies a person; a name spelled two ways across two pages does not make two
  // people. Dedupe on the strongest identifier present so "3 patients" means three actual patients.
  const rawList = Array.isArray(obj.patients) ? obj.patients.slice(0, MAX_PATIENTS) : [];
  const seen = new Set<string>();
  const patients: FaxPatientHint[] = [];
  for (const entry of rawList) {
    const p = (entry ?? {}) as Record<string, unknown>;
    const hint: FaxPatientHint = {
      lastName: cleanText(p.lastName, 30),
      firstName: cleanText(p.firstName, 30),
      dateOfBirth: cleanDate(p.dateOfBirth),
      // Digits only. A PHN with a letter in it is an OCR artefact, and a partial one must not be
      // sent to the box as if it were a health number.
      phn: cleanText(p.phn, 20).replace(/[^0-9]/g, ""),
      pages: cleanText(p.pages, 20),
    };
    if (!hint.lastName && !hint.firstName && !hint.phn) continue;   // nothing to identify anyone by
    const key = hint.phn
      ? "phn:" + hint.phn
      : ["name:", hint.lastName, hint.firstName, hint.dateOfBirth].join("|").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    patients.push(hint);
  }

  const confidence: FaxConfidence =
    obj.confidence === "high" || obj.confidence === "medium" || obj.confidence === "low"
      ? obj.confidence
      : "low";

  // The number a reply gets faxed to. A full NANP shape (area code and exchange both [2-9]xx) or
  // nothing — the exchange rule also rejects most PHNs misread as fax numbers, and a truncated or
  // padded number here would send PHI to a stranger's machine.
  let fax = cleanText(obj.senderFaxNumber, 20).replace(/[^0-9]/g, "");
  if (fax.length === 11 && fax.startsWith("1")) fax = fax.slice(1);
  const senderFaxNumber = /^[2-9]\d{2}[2-9]\d{6}$/.test(fax) ? fax : "";
  const pg = typeof obj.senderFaxPage === "number" ? Math.trunc(obj.senderFaxPage) : 0;
  const senderFaxPage = senderFaxNumber && pg >= 1 && pg <= 500 ? pg : 0;

  return {
    documentType: typeAllowed.has(documentType) ? documentType : UNKNOWN,
    documentClass: classAllowed.has(documentClass) ? documentClass : UNKNOWN,
    description: cleanText(obj.description, MAX_DESCRIPTION),
    observationDate: cleanDate(obj.observationDate),
    patients,
    multiPatient: patients.length > 1,
    // Only ever populated for a single-patient fax. With several, there is no "the" patient, and
    // handing one back would be exactly the confident wrong answer this guard exists to prevent.
    patient: patients.length === 1 ? patients[0] : emptyPatient(),
    addressedTo: {
      name: cleanText(addressedRaw.name, 80),
      mspNumber: cleanText(addressedRaw.mspNumber, 12).replace(/[^0-9]/g, ""),
    },
    senderFacility: cleanText(obj.senderFacility, 120),
    senderFaxNumber,
    senderFaxPage,
    confidence,
    evidence: cleanText(obj.evidence, 200),
  };
}
