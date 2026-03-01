export const AUTH_MFA_POLICY = {
  // ASVS V6.6.1 posture: PSTN OTP (SMS/voice) is not offered.
  allowPstnOtp: false,
  primaryOtpChannels: ["email"] as const,
  recoveryChannels: ["backup_code"] as const,
} as const;

export type AuthMfaPolicy = typeof AUTH_MFA_POLICY;
