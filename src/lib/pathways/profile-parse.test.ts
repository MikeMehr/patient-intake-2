import { describe, expect, it } from "vitest";
import { parseSpecialistProfileText } from "./profile-parse";

// Real innerText captured from pathwaysbc.ca/specialists/12632 (Dr. Naveed Malek) 2026-08-11.
const MALEK_TEXT = `Dr. Naveed Malek
Neurology
Man, MSP #Q5759
Accepting consultative referrals.
Offers virtual care services by video.
Details:
English is the only language spoken in the clinic. Dr. Malek will NOT see WSBC/ICBC cases. Dr. Malek's office time is limited so not all referrals will be accepted.
Incorrect Information? Let us know
Office Information
604-273-2502
Fax: 604-394-2556
Public email (okay for patient use): brighouse@terranovamedical.ca
Terra Nova Brighouse Clinic - #709, 8119 Park Road, Richmond, British Columbia, V6Y 0M5 with 2 others
Phone lines open Monday - Friday: 9:00 AM - 4:00 PM.
English is spoken by the consultant.
Referral Information and Requirements
Accepted by: fax.
Responded to by: Directly contacting the patient.
Required information / investigations for all referrals:
Clearly stated reason for referral and relevant labs, imaging, and previous consultations.`;

describe("parseSpecialistProfileText", () => {
  it("extracts every field from a full real profile", () => {
    const result = parseSpecialistProfileText(MALEK_TEXT);
    expect(result).toEqual({
      phone: "604-273-2502",
      fax: "604-394-2556",
      email: "brighouse@terranovamedical.ca",
      clinicAddress: "Terra Nova Brighouse Clinic - #709, 8119 Park Road, Richmond, British Columbia, V6Y 0M5",
      acceptedBy: "fax",
      respondedBy: "Directly contacting the patient",
    });
  });

  it("handles a business-name-only address with no phone/fax/email", () => {
    const text = `Dr. Michael Samycia
Dermatology
Office Information
Elicare Medical
Referral Information and Requirements
Accepted by: fax.`;
    const result = parseSpecialistProfileText(text);
    expect(result.clinicAddress).toBe("Elicare Medical");
    expect(result.phone).toBeNull();
    expect(result.fax).toBeNull();
    expect(result.email).toBeNull();
  });

  it("returns nulls for everything when there's no Office Information section", () => {
    const result = parseSpecialistProfileText("Dr. Nobody\nSome other page text.");
    expect(result).toEqual({
      phone: null,
      fax: null,
      email: null,
      clinicAddress: null,
      acceptedBy: null,
      respondedBy: null,
    });
  });

  it("does not mistake a phone number for the address", () => {
    const text = `Office Information
604-273-2502
Referral Information and Requirements`;
    const result = parseSpecialistProfileText(text);
    expect(result.phone).toBe("604-273-2502");
    expect(result.clinicAddress).toBeNull();
  });

  // Real innerText captured from pathwaysbc.ca/specialists/5230 (Dr. "Has" Hassanain Toma)
  // 2026-08-11 — a hospital-based specialist with NO "Office Information" heading at all; the
  // contact details render under a clinic/program block instead.
  const HOSPITAL_BASED_TEXT = `Dr. "Has" Hassanain Toma
Neurology
Man, MSP #67118
Only works out of hospitals, clinics, and/or community and health authority programs.
Incorrect Information? Let us know
Referral Information and Requirements
Wait Times
Average non-urgent patient wait time from referral to appointment: 1-2 weeks
Accepting consultative referrals.
Limitations:
The Stroke Prevention Clinic is a clinic for patients with recent onset of signs and symptoms of a TIA.
604-520-4661
Fax: 604-520-4188
In Royal Columbian Hospital
330 E Columbia Street, New Westminster, British Columbia, V3L 3W7
Clinic is located on the basement level of Health Care Centre.`;

  it("falls back to the clinic block for a hospital-based specialist with no Office Information", () => {
    const result = parseSpecialistProfileText(HOSPITAL_BASED_TEXT);
    expect(result.phone).toBe("604-520-4661");
    expect(result.fax).toBe("604-520-4188");
    expect(result.clinicAddress).toBe(
      "In Royal Columbian Hospital, 330 E Columbia Street, New Westminster, British Columbia, V3L 3W7",
    );
  });

  it("still prefers the Office Information block when both layouts could match", () => {
    // Malek's page also contains a postal code, so the fallback must not override the real
    // office block.
    const result = parseSpecialistProfileText(MALEK_TEXT);
    expect(result.phone).toBe("604-273-2502");
    expect(result.clinicAddress).toContain("Terra Nova Brighouse Clinic");
  });

  // Live bug: OSCAR record 1620 got "Private email (for physician office use only): …" written
  // into its address field, because only a "Public email" prefix was being skipped.
  it("never treats an email line as the address, however it is labelled", () => {
    const text = `Dr. Brendan O'Malley
Internal Medicine
Office Information
250-748-1323
Private email (for physician office use only): cowichaninternistgroup@gmail.com
Cowichan District Hospital - 3045 Gibbins Road, Duncan, British Columbia, V9L 1E5
Referral Information and Requirements`;
    const r = parseSpecialistProfileText(text);
    expect(r.email).toBe("cowichaninternistgroup@gmail.com");
    expect(r.phone).toBe("250-748-1323");
    expect(r.clinicAddress).toBe("Cowichan District Hospital - 3045 Gibbins Road, Duncan, British Columbia, V9L 1E5");
  });

  it("returns no address when nothing on the page carries a postal code", () => {
    const result = parseSpecialistProfileText("Dr. Nobody\nNeurology\nNo contact details here.");
    expect(result.clinicAddress).toBeNull();
    expect(result.phone).toBeNull();
  });
});
