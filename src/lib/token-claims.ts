export type TokenType = "invitation_session" | "password_reset" | "mfa_challenge";

export type TokenContext =
  | "invitation_verified_session"
  | "auth_password_reset"
  | "auth_login_mfa"
  | "auth_password_reset_mfa";

export type ExpectedTokenClaims = {
  iss: string;
  aud: string;
  type: TokenType;
  context: TokenContext;
};

const DEFAULT_ISSUER = "health-assist-ai";
const DEFAULT_AUDIENCE = "health-assist-app";

function sanitize(value: string | undefined, fallback: string): string {
  const normalized = (value || "").trim();
  return normalized.length > 0 ? normalized : fallback;
}

export function getTokenIssuer(): string {
  return sanitize(
    process.env.TOKEN_ISSUER || process.env.NEXT_PUBLIC_APP_URL,
    DEFAULT_ISSUER,
  );
}

export function getTokenAudience(): string {
  return sanitize(process.env.TOKEN_AUDIENCE, DEFAULT_AUDIENCE);
}

export function getExpectedTokenClaims(
  type: TokenType,
  context: TokenContext,
): ExpectedTokenClaims {
  return {
    iss: getTokenIssuer(),
    aud: getTokenAudience(),
    type,
    context,
  };
}

export function hasExpectedTokenClaims(
  candidate: {
    iss?: string | null;
    aud?: string | null;
    type?: string | null;
    context?: string | null;
  },
  expected: ExpectedTokenClaims,
): boolean {
  return (
    candidate.iss === expected.iss &&
    candidate.aud === expected.aud &&
    candidate.type === expected.type &&
    candidate.context === expected.context
  );
}
