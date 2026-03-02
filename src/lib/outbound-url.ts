import { isIP } from "net";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "169.254.169.254",
  "metadata.google.internal",
]);

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

function isBlockedIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd");
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local")) return true;

  const ipVersion = isIP(host);
  if (ipVersion === 4) return isPrivateIpv4(host);
  if (ipVersion === 6) return isBlockedIpv6(host);
  return false;
}

export function assertSafeOutboundUrl(input: string, options?: { allowedHosts?: string[]; label?: string }): URL {
  const label = options?.label || "Outbound URL";
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`${label} is invalid`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must use https`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not include URL credentials`);
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error(`${label} points to a blocked host`);
  }

  if (options?.allowedHosts && options.allowedHosts.length > 0) {
    const normalizedHost = parsed.hostname.toLowerCase();
    const allowed = options.allowedHosts.map((host) => host.toLowerCase());
    if (!allowed.includes(normalizedHost)) {
      throw new Error(`${label} host is not allowlisted`);
    }
  }

  return parsed;
}

export function assertSafeOperationLocation(operationLocation: string, expectedEndpoint: string): URL {
  const opUrl = assertSafeOutboundUrl(operationLocation, { label: "Operation location URL" });
  const endpointUrl = assertSafeOutboundUrl(expectedEndpoint, { label: "Document intelligence endpoint" });
  if (opUrl.origin !== endpointUrl.origin) {
    throw new Error("Operation location host does not match configured endpoint");
  }
  return opUrl;
}
