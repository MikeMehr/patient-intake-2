// Maps structured LLM extractions onto the OSCAR eForm field names.
//
// fid=7 "1 - CT/XR/US Req - FHA" (MedicalImagingForm) field map, read from the
// live form_html (2026-08-24):
//   - Modality boxes are box-style text inputs set to 'X': Xray, Ultrasound,
//     CT, SpecialProcedures (the printed "Interventional Procedures / Angio").
//     The form's own quick-pick panel maps Doppler to the Ultrasound box with
//     "Doppler" appended to the exam text — we mirror that.
//   - ExamRequestedText: the bold centred exam line.
//   - RelevantHistory: the left "RELEVANT HISTORY" textarea.
//   - RelevantHistoryText: the right "REASON FOR EXAM" textarea (yes, really).
//   - subject: the chart subject line in the bottom action bar.
//   - Side/body-part checkboxes exist only in the quick-pick panel and merely
//     append text to ExamRequestedText, so side always travels in the exam text.
//   - Risk-factor boxes (PregnantYes/No, DiabeticYes/No, anticoagulants, …) are
//     deliberately absent from this map: unknown information is never ticked.
//
// fid=3 "* Lab Requisition" (FormName): test boxes are 'X'-valued text inputs
// whose ids come from mapLabTestsToEformFields; free text goes to
// DiagnosisAndIndications / AdditionalTestInstructions / subject.

// The Consultation Request page (ConsultationFormRequest.jsp, patched by
// patch_consultation_prefill.py) is targeted via `selects` + `fields`:
//   - `service` select: options are built client-side from the consultation
//     services list, so we match by visible text (the specialty name);
//   - `urgency` select: matched by option value — 2 = Non-Urgent, 1 = Urgent;
//   - `reasonForConsultation` / `clinicalInformation` textareas.
// One consultation request per referral — multiple referrals yield multiple specs.

import { mapLabTestsToEformFields } from "@/lib/lab-requisition-mapping";
import { EFORM_FIDS, type FillSpec, type RxItem } from "@/lib/oscar/eform-prefill";

export type ImagingModality = "xray" | "ct" | "ultrasound" | "doppler" | "other";

export type ImagingStudy = {
  modality: ImagingModality;
  bodyPart: string;
  side: "left" | "right" | "bilateral" | null;
};

export type ImagingExtraction = {
  studies: ImagingStudy[];
  relevantHistory: string;
  reasonForExam: string;
};

export type LabsExtraction = {
  tests: string[];
  indication: string;
  subject: string;
};

const IMAGING_MODALITY_CHECKS: Record<ImagingModality, string | null> = {
  xray: "Xray",
  ct: "CT",
  ultrasound: "Ultrasound",
  doppler: "Ultrasound",
  other: null,
};

const IMAGING_MODALITY_LABELS: Record<ImagingModality, string> = {
  xray: "X-ray",
  ct: "CT",
  ultrasound: "Ultrasound",
  doppler: "Doppler",
  other: "",
};

function describeStudy(study: ImagingStudy): string {
  const parts = [
    IMAGING_MODALITY_LABELS[study.modality],
    study.side ?? "",
    study.bodyPart.trim(),
  ].filter(Boolean);
  return parts.join(" ");
}

export type ImagingFillResult = {
  spec: FillSpec;
  summary: { studies: string[] };
};

/** All recommended studies are combined into ONE requisition form. */
export function buildImagingFillSpec(
  extraction: ImagingExtraction,
  demographicNo: string,
): ImagingFillResult {
  const checks = new Set<string>();
  const studyLines: string[] = [];
  for (const study of extraction.studies) {
    const check = IMAGING_MODALITY_CHECKS[study.modality];
    if (check) checks.add(check);
    const line = describeStudy(study);
    if (line && !studyLines.includes(line)) studyLines.push(line);
  }
  const examText = studyLines.join("; ");

  const fields: Record<string, string> = {};
  if (examText) {
    fields.ExamRequestedText = examText;
    fields.subject = `Imaging req: ${examText}`;
  }
  if (extraction.relevantHistory.trim()) fields.RelevantHistory = extraction.relevantHistory.trim();
  if (extraction.reasonForExam.trim()) fields.RelevantHistoryText = extraction.reasonForExam.trim();

  return {
    spec: {
      v: 1,
      fid: EFORM_FIDS.imaging,
      demographicNo,
      checks: Array.from(checks),
      fields,
    },
    summary: { studies: studyLines },
  };
}

export type ReferralItem = {
  service: string;
  urgency: "routine" | "urgent";
  reason: string;
  clinicalInformation: string;
};

export type ReferralExtraction = {
  referrals: ReferralItem[];
};

const URGENCY_OPTION_VALUES: Record<ReferralItem["urgency"], string> = {
  routine: "2", // "Non-Urgent"
  urgent: "1",
};

export type ReferralFillResult = {
  specs: FillSpec[];
  summary: { referrals: string[] };
};

/** One Consultation Request per referral. `fid` is 0 — the page is not an eForm. */
export function buildReferralFillSpecs(
  extraction: ReferralExtraction,
  demographicNo: string,
): ReferralFillResult {
  const specs: FillSpec[] = [];
  const referralLines: string[] = [];
  for (const referral of extraction.referrals) {
    const fields: Record<string, string> = {};
    if (referral.reason.trim()) fields.reasonForConsultation = referral.reason.trim();
    if (referral.clinicalInformation.trim()) {
      fields.clinicalInformation = referral.clinicalInformation.trim();
    }
    const selects: Record<string, string> = {
      urgency: URGENCY_OPTION_VALUES[referral.urgency] ?? URGENCY_OPTION_VALUES.routine,
    };
    if (referral.service.trim()) selects.service = referral.service.trim();
    specs.push({ v: 1, fid: 0, demographicNo, checks: [], fields, selects });
    referralLines.push(referral.service.trim() || "Consultation");
  }
  return { specs, summary: { referrals: referralLines } };
}

export type PrescriptionItem = {
  drug: string;
  strength: string;
  sig: string;
  quantity: string;
  repeats: string;
  prn: boolean;
};

export type PrescriptionExtraction = {
  prescriptions: PrescriptionItem[];
};

export type PrescriptionFillResult = {
  spec: FillSpec;
  summary: { medications: string[] };
};

/**
 * All dictated prescriptions go on ONE Rx3 pad (fid 0 — not an eForm). PRN is
 * folded into the sig so parseIntr() picks it up; it never travels separately.
 */
export function buildPrescriptionFillSpec(
  extraction: PrescriptionExtraction,
  demographicNo: string,
): PrescriptionFillResult {
  const rx: RxItem[] = [];
  const medications: string[] = [];
  const seen = new Set<string>();
  for (const item of extraction.prescriptions) {
    const search = item.drug.trim().toLowerCase();
    if (!search) continue;
    const strength = item.strength.trim();
    const dedupeKey = `${search} ${strength}`.replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    let sig = item.sig.trim();
    if (item.prn && !/\bprn\b/i.test(sig)) sig = `${sig} PRN`.trim();
    const repeats = /^\d+$/.test(item.repeats.trim()) ? item.repeats.trim() : "0";
    const quantity = item.quantity.trim();

    rx.push({ search, strength, sig, quantity, repeats });
    medications.push(
      [
        [search, strength].filter(Boolean).join(" "),
        sig,
        quantity ? `qty ${quantity}` : "",
        `repeats ${repeats}`,
      ]
        .filter(Boolean)
        .join(" — "),
    );
  }
  return {
    spec: { v: 1, fid: 0, demographicNo, checks: [], fields: {}, rx },
    summary: { medications },
  };
}

export type LabsFillResult = {
  spec: FillSpec;
  summary: { mappedTests: string[]; unmappedTests: string[] };
};

export function buildLabsFillSpec(
  extraction: LabsExtraction,
  demographicNo: string,
): LabsFillResult {
  const mapping = mapLabTestsToEformFields(extraction.tests);

  const fields: Record<string, string> = {};
  const indication = extraction.indication.trim();
  // DiagnosisAndIndications normally copies itself into subject on blur, but a
  // programmatic set never blurs — fill both explicitly.
  if (indication) {
    fields.DiagnosisAndIndications = indication;
    fields.subject = extraction.subject.trim() || indication;
  } else if (extraction.subject.trim()) {
    fields.subject = extraction.subject.trim();
  }
  if (mapping.unmappedTests.length > 0) {
    fields.AdditionalTestInstructions = mapping.unmappedTests.join("; ");
  }

  return {
    spec: {
      v: 1,
      fid: EFORM_FIDS.labs,
      demographicNo,
      checks: mapping.mappedFieldIds,
      fields,
    },
    summary: { mappedTests: mapping.mappedTests, unmappedTests: mapping.unmappedTests },
  };
}
