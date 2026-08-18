import { describe, expect, it } from "vitest";
import { emptyExtraction, validateSpecialistResponse } from "./specialist-extract";

/** What the model would return for the canonical PathwaysBC paste (Dr. Harmon Toor). */
function toorEntry(overrides: Record<string, unknown> = {}) {
  return {
    salutation: "Dr.",
    firstName: "Harmon",
    lastName: "Toor",
    proLetters: "",
    specialty: "Dermatology",
    mspNumber: "Q4978",
    phone: "604-247-9378",
    fax: "604-273-2363",
    email: "freshbayderm@gmail.com",
    address: "Fresh Bay Health Centre - #305, 2777 Jow Street, Richmond, British Columbia, V6X 0V7 with 5 others",
    website: "",
    evidence: "Dr. Harmon Toor Dermatology",
    ...overrides,
  };
}

function response(entries: unknown[], confidence = "high") {
  return { specialists: entries, confidence };
}

describe("validateSpecialistResponse", () => {
  it("extracts the canonical PathwaysBC profile", () => {
    const out = validateSpecialistResponse(response([toorEntry()]));
    expect(out.specialists).toHaveLength(1);
    const s = out.specialists[0];
    expect(s.salutation).toBe("Dr.");
    expect(s.firstName).toBe("Harmon");
    expect(s.lastName).toBe("Toor");
    expect(s.specialty).toBe("Dermatology");
    expect(s.suggestedOscarService).toBe("Dermatology");
    expect(s.phone).toBe("604-247-9378");
    expect(s.fax).toBe("604-273-2363");
    expect(s.email).toBe("freshbayderm@gmail.com");
    expect(out.confidence).toBe("high");
    expect(out.reason).toBe("");
  });

  it("blanks an alphanumeric MSP number as referralNo but preserves it in the annotation", () => {
    const s = validateSpecialistResponse(response([toorEntry()])).specialists[0];
    expect(s.mspNumber).toBe("Q4978");
    expect(s.referralNo).toBe("");
    expect(s.annotation).toBe(
      "Added from PathwaysBC. MSP # Q4978 (not a 6-digit referral number — left blank in OSCAR).",
    );
  });

  it("applies OSCAR's referral number rule: 6 digits pass, 5 digits zero-pad", () => {
    const six = validateSpecialistResponse(response([toorEntry({ mspNumber: "669020" })])).specialists[0];
    expect(six.referralNo).toBe("669020");
    expect(six.annotation).toBe("Added from PathwaysBC.");
    const five = validateSpecialistResponse(response([toorEntry({ mspNumber: "29328" })])).specialists[0];
    expect(five.referralNo).toBe("029328");
  });

  it("strips the 'with N others' suffix off a shared clinic address", () => {
    const s = validateSpecialistResponse(response([toorEntry()])).specialists[0];
    expect(s.address).toBe(
      "Fresh Bay Health Centre - #305, 2777 Jow Street, Richmond, British Columbia, V6X 0V7",
    );
  });

  it("strips a leaked 'This practice opened...' sentence off the address", () => {
    const s = validateSpecialistResponse(
      response([toorEntry({ address: "2777 Jow Street, Richmond, V6X 0V7. This practice opened at this location in 2026." })]),
    ).specialists[0];
    expect(s.address).toBe("2777 Jow Street, Richmond, V6X 0V7.");
  });

  it("maps a PathwaysBC specialty to this clinic's OSCAR service name", () => {
    const ortho = validateSpecialistResponse(response([toorEntry({ specialty: "Orthopedics" })])).specialists[0];
    expect(ortho.suggestedOscarService).toBe("Orthopaedics");
    const gp = validateSpecialistResponse(response([toorEntry({ specialty: "Family Medicine" })])).specialists[0];
    expect(gp.suggestedOscarService).toBe("GP");
  });

  it("reformats NANP phone numbers and passes odd ones through for the physician to fix", () => {
    const clean = validateSpecialistResponse(
      response([toorEntry({ phone: "(604) 247 9378", fax: "1-604-273-2363" })]),
    ).specialists[0];
    expect(clean.phone).toBe("604-247-9378");
    expect(clean.fax).toBe("604-273-2363");
    // 123... has an invalid area code — not blanked, because phone is required by OSCAR.
    const odd = validateSpecialistResponse(response([toorEntry({ phone: "123-456-7890" })])).specialists[0];
    expect(odd.phone).toBe("123-456-7890");
  });

  it("blanks an off-list salutation and a malformed email", () => {
    const s = validateSpecialistResponse(
      response([toorEntry({ salutation: "Prof.", email: "not-an-email" })]),
    ).specialists[0];
    expect(s.salutation).toBe("");
    expect(s.email).toBe("");
  });

  it("keeps two distinct specialists and dedupes a repeated one", () => {
    const out = validateSpecialistResponse(
      response([
        toorEntry(),
        toorEntry({ firstName: "Sara", lastName: "Chen", specialty: "Rheumatology" }),
        toorEntry(), // repeat of the first
      ]),
    );
    expect(out.specialists).toHaveLength(2);
    expect(out.specialists[1].lastName).toBe("Chen");
  });

  it("drops an entry with no last name", () => {
    const out = validateSpecialistResponse(response([toorEntry({ lastName: "" })]));
    expect(out.specialists).toHaveLength(0);
    expect(out.reason).toBe("nothing_extracted");
  });

  it("returns an empty extraction for garbage model output", () => {
    expect(validateSpecialistResponse(null)).toEqual(emptyExtraction("model_output_invalid"));
    expect(validateSpecialistResponse("text")).toEqual(emptyExtraction("model_output_invalid"));
    expect(validateSpecialistResponse({}).reason).toBe("nothing_extracted");
  });
});
