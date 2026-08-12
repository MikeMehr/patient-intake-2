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

/** A well-formed model answer; individual tests corrupt one field at a time. */
function goodResponse(overrides: Record<string, unknown> = {}) {
  return {
    documentType: "radiology",
    documentClass: "Diagnostic Imaging Report",
    description: "Renal Ultrasound",
    observationDate: "2026-08-10",
    patient: { lastName: "Semilla", firstName: "Krizelle", dateOfBirth: "1990-10-30", phn: "9790813535" },
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

  it("is strict with every field required, including nested objects", () => {
    const schema = buildFaxSchema(DOC_TYPES, DOC_CLASSES);
    expect(schema.json_schema.strict).toBe(true);
    expect(schema.json_schema.schema.additionalProperties).toBe(false);
    // Azure rejects a strict schema whose nested objects are lax, so this is a real constraint.
    expect(schema.json_schema.schema.properties.patient.additionalProperties).toBe(false);
    expect(schema.json_schema.schema.properties.patient.required).toEqual([
      "lastName",
      "firstName",
      "dateOfBirth",
      "phn",
    ]);
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
  it("passes a clean answer through", () => {
    const out = validateFaxResponse(goodResponse(), DOC_TYPES, DOC_CLASSES);
    expect(out.documentType).toBe("radiology");
    expect(out.description).toBe("Renal Ultrasound");
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
      goodResponse({ patient: { lastName: "X", firstName: "Y", dateOfBirth: "", phn: "9809250242 BC" } }),
      DOC_TYPES,
      DOC_CLASSES,
    );
    expect(out.patient.phn).toBe("9809250242");
  });

  it("returns an empty suggestion for junk", () => {
    expect(validateFaxResponse(null, DOC_TYPES, DOC_CLASSES)).toEqual(emptySuggestion());
    expect(validateFaxResponse("not an object", DOC_TYPES, DOC_CLASSES)).toEqual(emptySuggestion());
  });

  it("tolerates missing nested objects without throwing", () => {
    const out = validateFaxResponse({ documentType: "lab" }, DOC_TYPES, DOC_CLASSES);
    expect(out.documentType).toBe("lab");
    expect(out.patient.lastName).toBe("");
    expect(out.addressedTo.name).toBe("");
    expect(out.confidence).toBe("low");
  });

  it("caps an over-long description instead of discarding it", () => {
    const out = validateFaxResponse(goodResponse({ description: "R".repeat(200) }), DOC_TYPES, DOC_CLASSES);
    expect(out.description).toHaveLength(60);
  });
});
