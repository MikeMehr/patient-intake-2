import { createHmac } from "crypto";

const RESET_TOKEN_SECRET_ENV = "RESET_TOKEN_HASH_SECRET";
const SESSION_SECRET_ENV = "SESSION_SECRET";

function getResetTokenSecret(): string {
  const explicitSecret = process.env[RESET_TOKEN_SECRET_ENV];
  if (explicitSecret && explicitSecret.length > 0) {
    return explicitSecret;
  }

  const sessionSecret = process.env[SESSION_SECRET_ENV];
  if (sessionSecret && sessionSecret.length > 0) {
    return sessionSecret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(`${RESET_TOKEN_SECRET_ENV} or ${SESSION_SECRET_ENV} is required`);
  }

  return "dev-reset-token-secret";
}

export function hashResetToken(rawToken: string): string {
  return createHmac("sha256", getResetTokenSecret()).update(rawToken).digest("hex");
}
