import { describe, it, expect, vi, beforeEach } from "vitest";

const send = vi.fn().mockResolvedValue({ id: "test" });

vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

process.env.RESEND_API_KEY = "test_key";
process.env.HIPAA_MODE = "false";

const { sendBookingConfirmation, sendCancellationConfirmation } = await import("./booking-email");

const base = {
  email: "patient@example.com",
  patientFirstName: "Manucher",
  clinicName: "MyMD Telehealth",
  slotStartTime: "2026-07-15T17:15:00.000Z",
  slotEndTime: "",
  timezone: "America/Vancouver",
  manageUrl: "https://example.com/manage/abc",
};

function lastHtml(): string {
  return send.mock.calls.at(-1)![0].html as string;
}

beforeEach(() => send.mockClear());

// Patient-facing booking emails deliberately never name the physician — the clinic
// books the visit, and which doctor takes it is not a commitment made to the patient.
describe("Physician row", () => {
  it("never appears in the confirmation email", async () => {
    await sendBookingConfirmation(base);
    const html = lastHtml();
    expect(html).not.toContain("Physician");
    expect(html).toContain("MyMD Telehealth");
    expect(html).toContain("Date &amp; time");
  });

  it("never appears in the cancellation email", async () => {
    await sendCancellationConfirmation({
      email: base.email,
      patientFirstName: base.patientFirstName,
      clinicName: base.clinicName,
      slotStartTime: base.slotStartTime,
      timezone: base.timezone,
    });
    expect(lastHtml()).not.toContain("Physician");
    expect(lastHtml()).toContain("Was scheduled for");
  });
});
