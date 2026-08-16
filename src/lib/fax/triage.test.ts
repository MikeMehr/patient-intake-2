import { describe, it, expect } from "vitest";
import {
  buildFaxSchema,
  buildFaxMessages,
  validateFaxResponse,
  emptySuggestion,
  UNKNOWN,
  type FaxProvider,
} from "@/lib/fax/triage";

const DOC_TYPES = ["lab", "consult", "radiology", "photo"];
const DOC_CLASSES = ["Consultant Report", "Diagnostic Imaging Report"];
const PROVIDERS: FaxProvider[] = [
  { name: "Manucher Mehraein", mspNumber: "67199" },
  { name: "Nahid Mehraein", mspNumber: "29328" },
];

const SEMILLA = {
  lastName: "Semilla",
  firstName: "Krizelle",
  dateOfBirth: "1990-10-30",
  phn: "9790813535",
  pages: "1",
};

/** A well-formed model answer; individual tests corrupt one field at a time. */
function goodResponse(overrides: Record<string, unknown> = {}) {
  return {
    documentType: "radiology",
    documentClass: "Diagnostic Imaging Report",
    description: "Renal Ultrasound",
    observationDate: "2026-08-10",
    patients: [SEMILLA],
    addressedTo: { name: "Dr. Manucher Mehraein", mspNumber: "67199" },
    senderFacility: "Burnaby Imaging",
    confidence: "high",
    evidence: "RENAL ULTRASOUND",
    ...overrides,
  };
}

describe("buildFaxSchema", () => {
  it("constrains documentType and documentClass to OSCAR's live lists plus unknown", () => {
    const schema = buildFaxSchema(DOC_TYPES, DOC_CLASSES);
    expect(schema.json_schema.schema.properties.documentType.enum).toEqual([...DOC_TYPES, UNKNOWN]);
    expect(schema.json_schema.schema.properties.documentClass.enum).toEqual([...DOC_CLASSES, UNKNOWN]);
  });

  it("is strict with every field required, including inside the patients array", () => {
    const schema = buildFaxSchema(DOC_TYPES, DOC_CLASSES);
    expect(schema.json_schema.strict).toBe(true);
    expect(schema.json_schema.schema.additionalProperties).toBe(false);
    // Azure rejects a strict schema whose nested objects are lax, so this is a real constraint.
    const item = schema.json_schema.schema.properties.patients.items;
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(["lastName", "firstName", "dateOfBirth", "phn", "pages"]);
  });
});

describe("buildFaxMessages", () => {
  it("offers the clinic's own doctors so the addressee can be recognised", () => {
    const [, user] = buildFaxMessages("OCR TEXT", DOC_TYPES, DOC_CLASSES, PROVIDERS);
    expect(user.content).toContain("Manucher Mehraein (MSP 67199)");
    expect(user.content).toContain("OCR TEXT");
  });

  it("survives a clinic with no providers on file", () => {
    const [, user] = buildFaxMessages("OCR TEXT", DOC_TYPES, DOC_CLASSES, []);
    expect(user.content).toContain("(none on file)");
  });
});

describe("validateFaxResponse", () => {
  it("passes a clean single-patient answer through", () => {
    const out = validateFaxResponse(goodResponse(), DOC_TYPES, DOC_CLASSES);
    expect(out.documentType).toBe("radiology");
    expect(out.description).toBe("Renal Ultrasound");
    expect(out.multiPatient).toBe(false);
    expect(out.patient.phn).toBe("9790813535");
    expect(out.addressedTo.mspNumber).toBe("67199");
  });

  it("rejects a document type that is not in this OSCAR", () => {
    const out = validateFaxResponse(goodResponse({ documentType: "ultrasound" }), DOC_TYPES, DOC_CLASSES);
    expect(out.documentType).toBe(UNKNOWN);
  });

  it("drops an impossible date rather than passing it to OSCAR", () => {
    const out = validateFaxResponse(goodResponse({ observationDate: "2026-02-31" }), DOC_TYPES, DOC_CLASSES);
    expect(out.observationDate).toBe("");
  });

  it("drops a non-ISO date", () => {
    const out = validateFaxResponse(goodResponse({ observationDate: "Aug 10 2026" }), DOC_TYPES, DOC_CLASSES);
    expect(out.observationDate).toBe("");
  });

  it("strips a province suffix and any OCR noise from the PHN", () => {
    const out = validateFaxResponse(
      goodResponse({ patients: [{ ...SEMILLA, phn: "9809250242 BC" }] }),
      DOC_TYPES,
      DOC_CLASSES,
    );
    expect(out.patient.phn).toBe("9809250242");
  });

  it("returns an empty suggestion for junk", () => {
    expect(validateFaxResponse(null, DOC_TYPES, DOC_CLASSES)).toEqual(emptySuggestion());
    expect(validateFaxResponse("not an object", DOC_TYPES, DOC_CLASSES)).toEqual(emptySuggestion());
  });

  it("tolerates a missing patients array without throwing", () => {
    const out = validateFaxResponse({ documentType: "lab" }, DOC_TYPES, DOC_CLASSES);
    expect(out.documentType).toBe("lab");
    expect(out.patients).toEqual([]);
    expect(out.patient.lastName).toBe("");
    expect(out.multiPatient).toBe(false);
    expect(out.confidence).toBe("low");
  });

  it("caps an over-long description instead of discarding it", () => {
    const out = validateFaxResponse(goodResponse({ description: "R".repeat(200) }), DOC_TYPES, DOC_CLASSES);
    expect(out.description).toHaveLength(60);
  });

  // ── The multi-patient guard ────────────────────────────────────────────────
  // A fax carrying several people's documents is the one case where a confident match misfiles a
  // record AND leaks it into a stranger's chart.

  it("flags a multi-patient fax and refuses to name a single patient", () => {
    const out = validateFaxResponse(
      goodResponse({
        patients: [
          SEMILLA,
          { lastName: "Prince", firstName: "Dakota", dateOfBirth: "1992-03-10", phn: "9135945977", pages: "2-3" },
        ],
      }),
      DOC_TYPES,
      DOC_CLASSES,
    );
    expect(out.multiPatient).toBe(true);
    expect(out.patients).toHaveLength(2);
    expect(out.patients[1].pages).toBe("2-3");
    // The whole point: no single patient to preselect.
    expect(out.patient).toEqual({ lastName: "", firstName: "", dateOfBirth: "", phn: "", pages: "" });
  });

  it("treats one person spelled two ways as one person when the health number agrees", () => {
    const out = validateFaxResponse(
      goodResponse({
        patients: [SEMILLA, { ...SEMILLA, firstName: "KRIZELLE F", pages: "2" }],
      }),
      DOC_TYPES,
      DOC_CLASSES,
    );
    expect(out.multiPatient).toBe(false);
    expect(out.patients).toHaveLength(1);
    expect(out.patient.phn).toBe("9790813535");
  });

  it("still separates two people who share a surname but not a health number", () => {
    const out = validateFaxResponse(
      goodResponse({
        patients: [
          { lastName: "Test", firstName: "Frank", dateOfBirth: "", phn: "", pages: "1" },
          { lastName: "Test", firstName: "Ali", dateOfBirth: "", phn: "", pages: "2" },
        ],
      }),
      DOC_TYPES,
      DOC_CLASSES,
    );
    expect(out.multiPatient).toBe(true);
    expect(out.patients).toHaveLength(2);
  });

  it("ignores entries with nothing to identify anyone by", () => {
    const out = validateFaxResponse(
      goodResponse({ patients: [SEMILLA, { lastName: "", firstName: "", dateOfBirth: "", phn: "", pages: "9" }] }),
      DOC_TYPES,
      DOC_CLASSES,
    );
    expect(out.multiPatient).toBe(false);
    expect(out.patients).toHaveLength(1);
  });
});
