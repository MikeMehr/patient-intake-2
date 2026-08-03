import { describe, expect, it } from "vitest";
import {
  MAX_NOTES_LEN,
  buildOscarAppointmentNotes,
  buildVideoLaunchUrl,
} from "./appointment-notes";

describe("buildOscarAppointmentNotes", () => {
  it("says how the appointment happens", () => {
    expect(buildOscarAppointmentNotes({ modality: "PHONE" })).toContain("Phone visit");
    expect(buildOscarAppointmentNotes({ modality: "VIDEO" })).toContain("Video visit");
    expect(buildOscarAppointmentNotes({ modality: "IN_PERSON" })).toContain("In-person visit");
  });

  it("keeps the old signal that this came from online booking", () => {
    expect(buildOscarAppointmentNotes({ modality: "PHONE" })).toContain("booked online");
  });

  it("includes the launch link for a video visit", () => {
    const notes = buildOscarAppointmentNotes({
      modality: "VIDEO",
      videoLaunchUrl: "https://physician.health-assist.org/launch/oscar-video?appointmentId=abc",
    });
    expect(notes).toContain("/launch/oscar-video?appointmentId=abc");
  });

  it("omits the link when there isn't one", () => {
    expect(buildOscarAppointmentNotes({ modality: "VIDEO", videoLaunchUrl: null })).not.toContain(
      "http",
    );
  });

  // appointment.notes is varchar(255) on the live box. OSCAR truncates silently rather than
  // erroring, and a truncated URL is worse than no URL — so the prose is what gives way.
  it("never exceeds the column width", () => {
    const notes = buildOscarAppointmentNotes({
      modality: "VIDEO",
      videoLaunchUrl: `https://example.com/launch/oscar-video?appointmentId=${"a".repeat(400)}`,
    });
    expect(notes.length).toBeLessThanOrEqual(MAX_NOTES_LEN);
  });

  it("drops the prose rather than cutting the URL when both won't fit", () => {
    const url = `https://example.com/launch/oscar-video?appointmentId=${"a".repeat(200)}`;
    const notes = buildOscarAppointmentNotes({ modality: "VIDEO", videoLaunchUrl: url });
    expect(notes.startsWith("https://")).toBe(true);
    expect(notes).not.toContain("Video visit");
  });

  // This value is rendered into the day-sheet row tooltip and into printed daysheets, so it gets
  // the same treatment as `reason`.
  it("strips angle brackets and control characters", () => {
    const notes = buildOscarAppointmentNotes({
      modality: "VIDEO",
      videoLaunchUrl: "https://x/y?a=<script>alert(1)</script>",
    });
    expect(notes).not.toContain("<");
    expect(notes).not.toContain(">");
    expect(notes).not.toContain("");
  });

  it("collapses whitespace so nothing wraps oddly on the day sheet", () => {
    const notes = buildOscarAppointmentNotes({
      modality: "VIDEO",
      videoLaunchUrl: "https://x/y   z\n\nw",
    });
    expect(notes).not.toMatch(/\s{2,}/);
    expect(notes).not.toContain("\n");
  });

  // The scribe answer is tri-state: silence must mean "not asked", never an invented answer.
  it("records a scribe consent", () => {
    expect(buildOscarAppointmentNotes({ modality: "PHONE", aiScribeConsent: true })).toContain(
      "AI scribe: OK",
    );
  });

  it("records a scribe decline loudly", () => {
    expect(buildOscarAppointmentNotes({ modality: "PHONE", aiScribeConsent: false })).toContain(
      "AI scribe: DECLINED",
    );
  });

  it("says nothing about the scribe when the question was never asked", () => {
    expect(buildOscarAppointmentNotes({ modality: "PHONE" })).not.toContain("AI scribe");
    expect(buildOscarAppointmentNotes({ modality: "PHONE", aiScribeConsent: null })).not.toContain(
      "AI scribe",
    );
  });

  it("still lets a long video URL win the width budget over the scribe note", () => {
    const url = `https://example.com/launch/oscar-video?appointmentId=${"a".repeat(200)}`;
    const notes = buildOscarAppointmentNotes({
      modality: "VIDEO",
      videoLaunchUrl: url,
      aiScribeConsent: false,
    });
    expect(notes.startsWith("https://")).toBe(true);
    expect(notes.length).toBeLessThanOrEqual(MAX_NOTES_LEN);
  });
});

describe("buildVideoLaunchUrl", () => {
  it("keys on our appointment id, since the OSCAR number doesn't exist yet at write time", () => {
    const url = buildVideoLaunchUrl("https://app.example.com", "abc-123");
    expect(url).toBe("https://app.example.com/launch/oscar-video?appointmentId=abc-123");
  });

  it("encodes the id", () => {
    expect(buildVideoLaunchUrl("https://a", "x/y&z")).toContain("appointmentId=x%2Fy%26z");
  });
});
