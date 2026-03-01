import { describe, expect, it } from "vitest";
import { AUTH_MFA_POLICY } from "./auth-policy";

describe("AUTH_MFA_POLICY", () => {
  it("keeps PSTN OTP disabled by default", () => {
    expect(AUTH_MFA_POLICY.allowPstnOtp).toBe(false);
  });

  it("publishes non-PSTN MFA channels", () => {
    expect(AUTH_MFA_POLICY.primaryOtpChannels).toEqual(["email"]);
    expect(AUTH_MFA_POLICY.recoveryChannels).toEqual(["backup_code"]);
  });
});
