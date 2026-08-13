import { describe, it, expect } from "vitest";
import { bookingCardMessage, checkBookingHealthCard } from "@/lib/billing/booking-msp-gate";

// A PHN that passes the BC check digit (mod 11 over digits 2..9), and the same number with the
// last digit bumped so it fails. Both are synthetic.
const VALID_BC_PHN = "9999999998";
const BAD_CHECKDIGIT = "9999999997";

describe("checkBookingHealthCard", () => {
  it("passes a BC PHN that survives its check digit", () => {
    expect(
      checkBookingHealthCard({
        coverageType: "CANADIAN_HEALTH_CARD",
        province: "British Columbia",
        healthCardNumber: VALID_BC_PHN,
      }),
    ).toEqual({ ok: true });
  });

  it("tolerates the spaces and dashes patients type", () => {
    expect(
      checkBookingHealthCard({
        coverageType: "CANADIAN_HEALTH_CARD",
        province: "BC",
        healthCardNumber: " 9999 999-998 ",
      }).ok,
    ).toBe(true);
  });

  it("rejects a PHN whose check digit fails", () => {
    const gate = checkBookingHealthCard({
      coverageType: "CANADIAN_HEALTH_CARD",
      province: "British Columbia",
      healthCardNumber: BAD_CHECKDIGIT,
    });
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.problem).toBe("invalid");
  });

  it("counts the digits back when the length is wrong", () => {
    const gate = checkBookingHealthCard({
      coverageType: "CANADIAN_HEALTH_CARD",
      province: "British Columbia",
      healthCardNumber: "99999999",
    });
    expect(gate.ok === false && gate.reason).toContain("you entered 8");
  });

  it("never echoes the number the patient typed", () => {
    const gate = checkBookingHealthCard({
      coverageType: "CANADIAN_HEALTH_CARD",
      province: "British Columbia",
      healthCardNumber: BAD_CHECKDIGIT,
    });
    expect(gate.ok === false && gate.reason).not.toContain(BAD_CHECKDIGIT);
  });

  it("turns away an out-of-province card even when it is a real one", () => {
    // Passes Ontario's Luhn check — a valid card, just not MSP coverage.
    const gate = checkBookingHealthCard({
      coverageType: "CANADIAN_HEALTH_CARD",
      province: "Ontario",
      healthCardNumber: "1234567893",
    });
    expect(gate.ok === false && gate.problem).toBe("out-of-province");
  });

  it("does not read a blank province as BC", () => {
    const gate = checkBookingHealthCard({
      coverageType: "CANADIAN_HEALTH_CARD",
      province: "",
      healthCardNumber: VALID_BC_PHN,
    });
    expect(gate.ok === false && gate.problem).toBe("province");
  });

  it("asks for the number when none was given", () => {
    const gate = checkBookingHealthCard({
      coverageType: "CANADIAN_HEALTH_CARD",
      province: "British Columbia",
      healthCardNumber: "",
    });
    expect(gate.ok === false && gate.problem).toBe("missing");
  });

  it("sends every non-MSP coverage type to the clinic instead of booking it", () => {
    for (const coverageType of ["PRIVATE_PAY", "TRAVEL_INSURANCE", "UNINSURED"]) {
      const gate = checkBookingHealthCard({ coverageType });
      expect(gate.ok === false && gate.problem).toBe("non-msp");
    }
  });

  it("never gets in the way of a patient who is already on the chart", () => {
    // Their coverage is whatever the clinic recorded, and the booking form does not re-ask.
    expect(checkBookingHealthCard({ coverageType: "EXISTING_OSCAR_PATIENT" }).ok).toBe(true);
  });
});

describe("bookingCardMessage", () => {
  it("offers a retry first, then the clinic's address, for a number that failed its check", () => {
    const msg = bookingCardMessage(
      { problem: "invalid", reason: "That is not a valid BC Personal Health Number." },
      "info@mymdonline.ca",
    );
    expect(msg).toBe(
      "That is not a valid BC Personal Health Number. Please check the number on your card and try again. " +
        "If the number is correct, please email the clinic at info@mymdonline.ca to book this appointment.",
    );
  });

  it("does not suggest retyping an out-of-province card — there is nothing to fix", () => {
    const msg = bookingCardMessage(
      { problem: "out-of-province", reason: "Out of province." },
      "info@mymdonline.ca",
    );
    expect(msg).toBe(
      "Out of province. Please email the clinic at info@mymdonline.ca to book this appointment.",
    );
  });

  it("does not send someone to email the clinic over a field they have not filled in yet", () => {
    const msg = bookingCardMessage(
      { problem: "missing", reason: "Please enter your health card number (PHN)." },
      "info@mymdonline.ca",
    );
    expect(msg).toBe("Please enter your health card number (PHN).");
  });

  it("stays generic when the clinic has no address on file", () => {
    const msg = bookingCardMessage({ problem: "out-of-province", reason: "Out of province." }, null);
    expect(msg).toBe("Out of province. Please contact the clinic to book this appointment.");
  });

  it("points a private-pay patient at the clinic", () => {
    const gate = checkBookingHealthCard({ coverageType: "PRIVATE_PAY" });
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && bookingCardMessage(gate, "info@mymdonline.ca")).toBe(
      "Online booking is for patients with valid BC MSP coverage. " +
        "Please email the clinic at info@mymdonline.ca to book this appointment.",
    );
  });
});
