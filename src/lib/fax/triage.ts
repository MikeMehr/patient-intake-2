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
  patient: FaxPatientHint;
  addressedTo: FaxAddressee;
  /** Clinic/hospital that sent the fax. Context for the physician; not used for matching. */
  senderFacility: string;
  confidence: FaxConfidence;
  /** Short quote from the fax supporting the reading. Shown on screen; never logged. */
  evidence: string;
};

/** Returned whenever there is nothing usable — bad OCR, model error, kill switch. */
export function emptySuggestion(): FaxTriageSuggestion {
  return {
    documentType: UNKNOWN,
    documentClass: UNKNOWN,
    description: "",
    observationDate: "",
    patient: { lastName: "", firstName: "", dateOfBirth: "", phn: "" },
    addressedTo: { name: "", mspNumber: "" },
    senderFacility: "",
    confidence: "low",
    evidence: "",
  };
}

/** OSCAR's description column is short, and a title longer than this is a summary, not a title. */
const MAX_DESCRIPTION = 60;

/** Faxes are a page or three. Well past any real one, and a bound on prompt size. */
const MAX_OCR_CHARS = 30_000;

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
  "Rules:",
  "- patient: the person the document is ABOUT. Not the sender, not the addressee, not a next of kin.",
  "  A fax cover sheet often names clinic staff and doctors — none of those is the patient.",
  "- phn: the BC Personal Health Number of that patient (also printed as PHN, Health #, MSP, or Care",
  "  Card). Digits only; drop any trailing province code. Never invent or complete a partial number.",
  "- dateOfBirth: the patient's date of birth. Do not confuse it with the collection date, the report",
  "  date, or the fax date. Output YYYY-MM-DD.",
  "- addressedTo: the doctor the fax is directed to — the 'To:', 'Attention:' or 'Dear Dr ...' line.",
  "  This is a doctor at the receiving clinic. The sending doctor is not the addressee.",
  "- senderFacility: the hospital, lab or clinic the fax came from.",
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
          "patient",
          "addressedTo",
          "senderFacility",
          "confidence",
          "evidence",
        ],
        properties: {
          documentType: { type: "string", enum: [...docTypes, UNKNOWN] },
          documentClass: { type: "string", enum: [...docClasses, UNKNOWN] },
          description: str,
          observationDate: str,
          patient: {
            type: "object",
            additionalProperties: false,
            required: ["lastName", "firstName", "dateOfBirth", "phn"],
            properties: {
              lastName: str,
              firstName: str,
              dateOfBirth: str,
              phn: str,
            },
          },
          addressedTo: {
            type: "object",
            additionalProperties: false,
            required: ["name", "mspNumber"],
            properties: { name: str, mspNumber: str },
          },
          senderFacility: str,
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
): ChatCompletionMessageParam[] {
  const roster = providers.length
    ? providers.map((p) => (p.mspNumber ? `${p.name} (MSP ${p.mspNumber})` : p.name)).join("\n")
    : "(none on file)";

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

  const patientRaw = (obj.patient ?? {}) as Record<string, unknown>;
  const addressedRaw = (obj.addressedTo ?? {}) as Record<string, unknown>;

  const confidence: FaxConfidence =
    obj.confidence === "high" || obj.confidence === "medium" || obj.confidence === "low"
      ? obj.confidence
      : "low";

  return {
    documentType: typeAllowed.has(documentType) ? documentType : UNKNOWN,
    documentClass: classAllowed.has(documentClass) ? documentClass : UNKNOWN,
    description: cleanText(obj.description, MAX_DESCRIPTION),
    observationDate: cleanDate(obj.observationDate),
    patient: {
      lastName: cleanText(patientRaw.lastName, 30),
      firstName: cleanText(patientRaw.firstName, 30),
      dateOfBirth: cleanDate(patientRaw.dateOfBirth),
      // Digits only. A PHN with a letter in it is an OCR artefact, and a partial one must not be
      // sent to the box as if it were a health number.
      phn: cleanText(patientRaw.phn, 20).replace(/[^0-9]/g, ""),
    },
    addressedTo: {
      name: cleanText(addressedRaw.name, 80),
      mspNumber: cleanText(addressedRaw.mspNumber, 12).replace(/[^0-9]/g, ""),
    },
    senderFacility: cleanText(obj.senderFacility, 120),
    confidence,
    evidence: cleanText(obj.evidence, 200),
  };
}
