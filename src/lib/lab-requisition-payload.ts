export type LabRequisitionPrefillPayload = {
  requestId: string;
  patient: {
    firstName: string;
    lastName: string;
    fullName: string;
    dob: string;
    sex: string;
    phn: string;
    email: string;
  };
  provider: {
    name: string;
    clinic: string;
    clinicAddress: string;
    phone: string;
    fax: string;
  };
  order: {
    tests: string[];
    testsDisplay: string[];
    clinicalInfoShort: string;
    priority: "routine" | "urgent";
    additionalInstructions: string;
    unmappedTests: string[];
  };
  editorFields?: Record<string, string | boolean>;
};

function splitName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  if (!trimmed) return { firstName: "", lastName: "" };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

export function buildLabRequisitionPrefillPayload(input: {
  requestId: string;
  patientName: string;
  patientEmail: string;
  patientDob?: string;
  patientSex?: string;
  patientPhn?: string;
  physicianName: string;
  clinicName: string;
  clinicAddress: string;
  clinicPhone?: string;
  clinicFax?: string;
  mappedFieldIds: string[];
  testsDisplay: string[];
  clinicalInfoShort: string;
  priority: "routine" | "urgent";
  additionalInstructions: string;
  unmappedTests: string[];
}): LabRequisitionPrefillPayload {
  const nameParts = splitName(input.patientName);
  return {
    requestId: input.requestId,
    patient: {
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      fullName: input.patientName.trim(),
      dob: input.patientDob ?? "",
      sex: input.patientSex ?? "",
      phn: input.patientPhn ?? "",
      email: input.patientEmail.trim(),
    },
    provider: {
      name: input.physicianName.trim(),
      clinic: input.clinicName.trim(),
      clinicAddress: input.clinicAddress.trim(),
      phone: input.clinicPhone ?? "",
      fax: input.clinicFax ?? "",
    },
    order: {
      tests: input.mappedFieldIds,
      testsDisplay: input.testsDisplay,
      clinicalInfoShort: input.clinicalInfoShort.trim(),
      priority: input.priority,
      additionalInstructions: input.additionalInstructions.trim(),
      unmappedTests: input.unmappedTests,
    },
  };
}
