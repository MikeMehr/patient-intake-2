import { describe, it, expect, vi, beforeEach } from "vitest";

const send = vi.fn().mockResolvedValue({ id: "test" });

vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

process.env.RESEND_API_KEY = "test_key";
process.env.HIPAA_MODE = "false";

const { sendBookingConfirmation } = await import("./booking-email");

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

describe("Appointment format in the confirmation email", () => {
  it("states a phone appointment and that the physician will call", async () => {
    await sendBookingConfirmation({ ...base, appointmentModality: "PHONE" });
    const html = lastHtml();
    expect(html).toContain("Your phone appointment is confirmed");
    expect(html).toContain("Format");
    expect(html).toContain("Phone appointment");
    expect(html).toContain("will call you");
  });

  it("states a video appointment when the clinic is set to video", async () => {
    await sendBookingConfirmation({ ...base, appointmentModality: "VIDEO" });
    const html = lastHtml();
    expect(html).toContain("Video appointment");
    // Waiting-room wording since the move to Doxy: the link arrives with this email and is
    // the same one every time, so nothing is "sent before the scheduled time".
    expect(html).toContain("video waiting room");
    expect(html).not.toContain("will call you");
  });

  it("states an in-person appointment when the clinic is set to in-person", async () => {
    await sendBookingConfirmation({ ...base, appointmentModality: "IN_PERSON" });
    const html = lastHtml();
    expect(html).toContain("In-person appointment");
    expect(html).toContain("come to the clinic");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
  ])("falls back to phone when the modality is %s", async (_label, appointmentModality) => {
    await sendBookingConfirmation({ ...base, appointmentModality });
    expect(lastHtml()).toContain("Phone appointment");
  });
});
