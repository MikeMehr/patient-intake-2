export const AUTH_MFA_POLICY = {
  // SMS (PSTN OTP) is the primary sign-in second factor, with email as a
  // fallback when no phone is on file. (Departs from ASVS V6.6.1's
  // no-PSTN-OTP posture by product decision.)
  allowPstnOtp: true,
  primaryOtpChannels: ["sms", "email"] as const,
  recoveryChannels: ["backup_code"] as const,
  webauthn: {
    enabled: true,
  },
} as const;

export type AuthMfaPolicy = typeof AUTH_MFA_POLICY;
