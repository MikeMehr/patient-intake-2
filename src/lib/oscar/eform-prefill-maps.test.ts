import { describe, it, expect } from "vitest";
import { buildImagingFillSpec, buildLabsFillSpec, buildReferralFillSpecs } from "./eform-prefill-maps";

describe("buildImagingFillSpec", () => {
  it("combines all studies into one form with modality checks and exam text", () => {
    const { spec, summary } = buildImagingFillSpec(
      {
        studies: [
          { modality: "xray", bodyPart: "knee", side: "right" },
          { modality: "ultrasound", bodyPart: "knee", side: "right" },
        ],
        relevantHistory: "Acute knee pain after biking, new bruising.",
        reasonForExam: "Rule out bony injury; assess for tendon tear.",
      },
      "42",
    );
    expect(spec.fid).toBe(7);
    expect(spec.demographicNo).toBe("42");
    expect(spec.checks.sort()).toEqual(["Ultrasound", "Xray"]);
    expect(spec.fields.ExamRequestedText).toBe("X-ray right knee; Ultrasound right knee");
    expect(spec.fields.RelevantHistory).toBe("Acute knee pain after biking, new bruising.");
    expect(spec.fields.RelevantHistoryText).toBe("Rule out bony injury; assess for tendon tear.");
    expect(spec.fields.subject).toContain("X-ray right knee");
    expect(summary.studies).toHaveLength(2);
  });

  it("maps doppler onto the Ultrasound box but keeps 'Doppler' in the exam text", () => {
    const { spec } = buildImagingFillSpec(
      {
        studies: [{ modality: "doppler", bodyPart: "leg veins", side: "left" }],
        relevantHistory: "",
        reasonForExam: "",
      },
      "42",
    );
    expect(spec.checks).toEqual(["Ultrasound"]);
    expect(spec.fields.ExamRequestedText).toBe("Doppler left leg veins");
  });

  it("never emits checks for unknown modalities or risk-factor boxes", () => {
    const { spec } = buildImagingFillSpec(
      {
        studies: [{ modality: "other", bodyPart: "chest", side: null }],
        relevantHistory: "",
        reasonForExam: "",
      },
      "42",
    );
    expect(spec.checks).toEqual([]);
    expect(spec.fields.ExamRequestedText).toBe("chest");
  });
});

describe("buildLabsFillSpec", () => {
  it("ticks mapped tests and overflows unmapped ones into instructions", () => {
    const { spec, summary } = buildLabsFillSpec(
      {
        tests: ["CBC", "TSH", "anti-CCP"],
        indication: "Joint pain, r/o rheumatoid arthritis",
        subject: "Bloodwork - RA workup",
      },
      "42",
    );
    expect(spec.fid).toBe(3);
    expect(spec.checks).toContain("HematologyProfile");
    expect(spec.checks).toContain("TSH");
    expect(summary.unmappedTests).toContain("anti-CCP");
    expect(spec.fields.AdditionalTestInstructions).toContain("anti-CCP");
    expect(spec.fields.DiagnosisAndIndications).toBe("Joint pain, r/o rheumatoid arthritis");
    expect(spec.fields.subject).toBe("Bloodwork - RA workup");
  });

  it("falls back to the indication when no subject was extracted", () => {
    const { spec } = buildLabsFillSpec(
      { tests: ["CBC"], indication: "Fatigue workup", subject: "" },
      "42",
    );
    expect(spec.fields.subject).toBe("Fatigue workup");
  });
});

describe("buildReferralFillSpecs", () => {
  it("builds one consultation spec per referral with service text and urgency value", () => {
    const { specs, summary } = buildReferralFillSpecs(
      {
        referrals: [
          {
            service: "Dermatology",
            urgency: "routine",
            reason: "Evaluate a nevus on the tip of the nose.",
            clinicalInformation: "No change in size; no bleeding.",
          },
          { service: "Orthopedics", urgency: "urgent", reason: "Knee instability.", clinicalInformation: "" },
        ],
      },
      "45",
    );
    expect(specs).toHaveLength(2);
    expect(specs[0].demographicNo).toBe("45");
    expect(specs[0].selects).toEqual({ urgency: "2", service: "Dermatology" });
    expect(specs[0].fields.reasonForConsultation).toBe("Evaluate a nevus on the tip of the nose.");
    expect(specs[0].fields.clinicalInformation).toBe("No change in size; no bleeding.");
    expect(specs[1].selects).toEqual({ urgency: "1", service: "Orthopedics" });
    expect(specs[1].fields.clinicalInformation).toBeUndefined();
    expect(summary.referrals).toEqual(["Dermatology", "Orthopedics"]);
  });
});
