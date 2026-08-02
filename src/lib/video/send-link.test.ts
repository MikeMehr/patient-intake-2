/**
 * The HIPAA_MODE silent-success trap.
 *
 * Every pre-existing sender in sms.ts returns `{success: true}` when HIPAA_MODE suppresses the
 * send. That is defensible for a background alert nobody is waiting on, but it is exactly wrong
 * for a provider standing at the console pressing "text the link": a green tick over a message
 * that was never sent leaves a patient waiting for something that isn't coming, and the provider
 * with no reason to suspect it.
 *
 * These tests pin the distinction down. If someone later "makes the video senders consistent
 * with the rest of the file", this fails.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalHipaaMode = process.env.HIPAA_MODE;

beforeEach(() => {
  vi.resetModules();
  process.env.HIPAA_MODE = "false";
  process.env.TWILIO_PHONE_NUMBER = "+16045550000";
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "token";
});

afterEach(() => {
  if (originalHipaaMode === undefined) delete process.env.HIPAA_MODE;
  else process.env.HIPAA_MODE = originalHipaaMode;
  vi.restoreAllMocks();
});

describe("sendVideoLinkSMS under HIPAA_MODE", () => {
  it("reports suppression instead of a false success", async () => {
    process.env.HIPAA_MODE = "true";
    const { sendVideoLinkSMS } = await import("@/lib/sms");

    const res = await sendVideoLinkSMS("+16045551234", {
      clinicName: "MyMD",
      joinUrl: "https://example.com/visit/abc",
    });

    expect(res.outcome).toBe("suppressed");
    // The legacy shape — `{success: true}` — must not be what this returns.
    expect((res as { success?: boolean }).success).toBeUndefined();
  });

  it("is distinguishable from an ordinary failure", async () => {
    process.env.HIPAA_MODE = "true";
    const { sendVideoLinkSMS } = await import("@/lib/sms");
    const res = await sendVideoLinkSMS("+16045551234", { clinicName: "c", joinUrl: "u" });
    expect(res.outcome).not.toBe("failed");
    expect(res.outcome).not.toBe("sent");
  });
});

describe("sendVideoLinkSMS validation", () => {
  it("rejects a number that can't be normalized rather than handing junk to Twilio", async () => {
    const { sendVideoLinkSMS } = await import("@/lib/sms");
    const res = await sendVideoLinkSMS("not a phone", { clinicName: "c", joinUrl: "u" });
    expect(res).toEqual({ outcome: "failed", error: "invalid_phone" });
  });

  it("reports suppression, not failure, when Twilio isn't configured at all", async () => {
    delete process.env.TWILIO_PHONE_NUMBER;
    const { sendVideoLinkSMS } = await import("@/lib/sms");
    const res = await sendVideoLinkSMS("+16045551234", { clinicName: "c", joinUrl: "u" });
    expect(res).toMatchObject({ outcome: "suppressed" });
  });

  it("normalizes a local number before sending", async () => {
    const { toE164 } = await import("@/lib/sms");
    expect(toE164("604 555 0123")).toBe("+16045550123");
    expect(toE164("(604) 555-0123")).toBe("+16045550123");
  });

  it("carries no patient name or clinical detail in the message body", async () => {
    const create = vi.fn().mockResolvedValue({ sid: "SM1", status: "queued" });
    vi.doMock("twilio", () => ({
      Twilio: class {
        messages = { create };
      },
    }));
    const { sendVideoLinkSMS } = await import("@/lib/sms");

    await sendVideoLinkSMS("+16045551234", {
      clinicName: "MyMD Medical Clinic",
      joinUrl: "https://example.com/visit/abc",
    });

    const body = create.mock.calls[0][0].body as string;
    expect(body).toContain("MyMD Medical Clinic");
    expect(body).toContain("https://example.com/visit/abc");
    expect(body).toContain("Reply STOP");
    // Nothing that says why they're being seen.
    expect(body.toLowerCase()).not.toContain("diagnos");
    expect(body.toLowerCase()).not.toContain("reason");
  });
});

describe("sendVideoVisitLinkEmail under HIPAA_MODE", () => {
  it("flags suppression distinctly from a send failure", async () => {
    process.env.HIPAA_MODE = "true";
    const { sendVideoVisitLinkEmail } = await import("@/lib/booking-email");

    const res = await sendVideoVisitLinkEmail({
      email: "patient@example.com",
      clinicName: "MyMD",
      joinUrl: "https://example.com/visit/abc",
    });

    expect(res.sent).toBe(false);
    // `suppressed` is what lets the route show the URL to read aloud instead of reporting an
    // error the provider can do nothing about.
    expect(res.suppressed).toBe(true);
  });
});
