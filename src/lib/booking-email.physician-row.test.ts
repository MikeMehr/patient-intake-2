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

describe("Physician row", () => {
  it("renders with the name when a physician resolved", async () => {
    await sendBookingConfirmation({ ...base, physicianName: "Dr. Nahid Mehraein" });
    expect(lastHtml()).toContain("Physician");
    expect(lastHtml()).toContain("Dr. Nahid Mehraein");
  });

  it.each([
    ["empty string", ""],
    ["whitespace", "   "],
    ["undefined", undefined],
    ["null", null],
  ])("is omitted entirely when the name is %s", async (_label, physicianName) => {
    await sendBookingConfirmation({ ...base, physicianName });
    expect(lastHtml()).not.toContain("Physician");
  });

  it("keeps the surrounding Clinic and Date rows intact when omitted", async () => {
    await sendBookingConfirmation({ ...base, physicianName: "" });
    const html = lastHtml();
    expect(html).toContain("MyMD Telehealth");
    expect(html).toContain("Date &amp; time");
    expect(html).not.toContain("Physician");
  });

  it("is omitted from the cancellation email too", async () => {
    await sendCancellationConfirmation({
      email: base.email,
      patientFirstName: base.patientFirstName,
      clinicName: base.clinicName,
      physicianName: "",
      slotStartTime: base.slotStartTime,
      timezone: base.timezone,
    });
    expect(lastHtml()).not.toContain("Physician");
    expect(lastHtml()).toContain("Was scheduled for");
  });
});
