"use client";

import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";

export { browserSupportsWebAuthn };

export async function registerPasskey(
  deviceName?: string,
): Promise<{ success: boolean; error?: string }> {
  // Step 1: Get registration options from server
  const optionsRes = await fetch("/api/auth/webauthn/register/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!optionsRes.ok) {
    const data = await optionsRes.json().catch(() => ({}));
    return { success: false, error: data.error || "Failed to get registration options" };
  }
  const { options } = await optionsRes.json();

  // Step 2: Create credential via browser WebAuthn API
  let credential;
  try {
    credential = await startRegistration({ optionsJSON: options });
  } catch (err: any) {
    if (err.name === "NotAllowedError") {
      return { success: false, error: "Registration was cancelled" };
    }
    return { success: false, error: err.message || "Registration failed" };
  }

  // Step 3: Verify with server
  const verifyRes = await fetch("/api/auth/webauthn/register/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      response: credential,
      expectedChallenge: options.challenge,
      deviceName,
    }),
  });
  if (!verifyRes.ok) {
    const data = await verifyRes.json().catch(() => ({}));
    return { success: false, error: data.error || "Verification failed" };
  }

  return { success: true };
}

export async function authenticateWithPasskey(username?: string): Promise<{
  success: boolean;
  data?: any;
  error?: string;
}> {
  // Step 1: Get authentication options.
  // If a username is provided, the server will look up that user's registered credential IDs
  // and include them as allowCredentials, so the browser presents the correct passkey directly.
  const optionsRes = await fetch("/api/auth/webauthn/login/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: username?.trim().toLowerCase() || undefined }),
  });
  if (!optionsRes.ok) {
    const data = await optionsRes.json().catch(() => ({}));
    return { success: false, error: data.error || "Failed to get authentication options" };
  }
  const { options } = await optionsRes.json();

  // Step 2: Authenticate via browser WebAuthn API
  let assertion;
  try {
    assertion = await startAuthentication({ optionsJSON: options });
  } catch (err: any) {
    if (err.name === "NotAllowedError") {
      return { success: false, error: "Authentication was cancelled" };
    }
    return { success: false, error: err.message || "Authentication failed" };
  }

  // Step 3: Verify with server
  const verifyRes = await fetch("/api/auth/webauthn/login/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      response: assertion,
      expectedChallenge: options.challenge,
    }),
  });
  if (!verifyRes.ok) {
    const data = await verifyRes.json().catch(() => ({}));
    return { success: false, error: data.error || "Authentication failed" };
  }

  const data = await verifyRes.json();
  return { success: true, data };
}
