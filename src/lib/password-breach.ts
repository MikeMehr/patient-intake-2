import { createHash } from "crypto";

export const BREACHED_PASSWORD_ERROR =
  "This password has been exposed in known data breaches. Please choose a different password.";
export const BREACH_CHECK_UNAVAILABLE_ERROR =
  "Password security check is temporarily unavailable. Please try again in a few minutes.";

const HIBP_RANGE_API = "https://api.pwnedpasswords.com/range/";
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;

type CacheEntry = {
  fetchedAt: number;
  suffixCounts: Map<string, number>;
};

type PasswordBreachAssessment = {
  breached: boolean;
  count: number;
  checked: boolean;
  failOpen: boolean;
  unavailable: boolean;
};

const prefixCache = new Map<string, CacheEntry>();

function getTimeoutMs(): number {
  const raw = Number(process.env.PASSWORD_BREACH_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

function getCacheTtlMs(): number {
  const raw = Number(process.env.PASSWORD_BREACH_CACHE_TTL_MS || DEFAULT_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CACHE_TTL_MS;
}

export function shouldFailOpenOnBreachCheckError(): boolean {
  return process.env.PASSWORD_BREACH_FAIL_OPEN === "true";
}

function normalizeSha1(password: string): string {
  return createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
}

function parseRangeResponse(raw: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [suffix, countText] = trimmed.split(":");
    if (!suffix || !countText) continue;
    const count = Number(countText);
    out.set(suffix.trim().toUpperCase(), Number.isFinite(count) ? count : 0);
  }
  return out;
}

async function fetchPrefixRange(prefix: string): Promise<Map<string, number>> {
  const cached = prefixCache.get(prefix);
  const ttlMs = getCacheTtlMs();
  if (cached && Date.now() - cached.fetchedAt < ttlMs) {
    return cached.suffixCounts;
  }

  const timeoutMs = getTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${HIBP_RANGE_API}${prefix}`, {
      method: "GET",
      headers: {
        "Add-Padding": "true",
        "User-Agent": process.env.PASSWORD_BREACH_USER_AGENT || "HealthAssistAI/1.0",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HIBP range request failed with status ${response.status}`);
    }

    const text = await response.text();
    const suffixCounts = parseRangeResponse(text);
    prefixCache.set(prefix, {
      fetchedAt: Date.now(),
      suffixCounts,
    });
    return suffixCounts;
  } finally {
    clearTimeout(timeout);
  }
}

export async function assessPasswordAgainstBreaches(
  password: string,
): Promise<PasswordBreachAssessment> {
  const failOpen = shouldFailOpenOnBreachCheckError();
  try {
    const digest = normalizeSha1(password);
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);
    const suffixCounts = await fetchPrefixRange(prefix);
    const count = suffixCounts.get(suffix) || 0;
    return {
      breached: count > 0,
      count,
      checked: true,
      failOpen,
      unavailable: false,
    };
  } catch (error) {
    if (!failOpen) {
      return {
        breached: false,
        count: 0,
        checked: false,
        failOpen,
        unavailable: true,
      };
    }
    console.error("[password-breach] check failed; continuing due to fail-open mode", error);
    return {
      breached: false,
      count: 0,
      checked: false,
      failOpen,
      unavailable: true,
    };
  }
}

