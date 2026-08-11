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
});
