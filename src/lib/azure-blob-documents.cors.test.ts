import { afterEach, describe, expect, it } from "vitest";
import type { CorsRule } from "@azure/storage-blob";
import { getDocumentsCorsOrigins, mergeDocumentsCorsRules } from "./azure-blob-documents";

/**
 * These two helpers are pure, so the whole CORS-drift story is testable without Azure and
 * without a network. The cases below are the real prod states, not invented ones.
 */

const PHYSICIAN = "https://physician.health-assist.org";
const DEFAULT_HOST =
  "https://healt-assist-ai-prod-f0bce3hwfhdrbvgr.canadacentral-01.azurewebsites.net";

/** The rule shape that was actually live when the outbound share flow broke. */
function mymdRule(): CorsRule {
  return {
    allowedOrigins: "https://mymd.health-assist.org",
    allowedMethods: "PUT, OPTIONS, HEAD, GET",
    allowedHeaders: "x-ms-blob-type, content-type, x-ms-blob-content-type",
    exposedHeaders: "*",
    maxAgeInSeconds: 3600,
  };
}

function permissiveRule(origins: string): CorsRule {
  return {
    allowedOrigins: origins,
    allowedMethods: "GET,HEAD,PUT,OPTIONS",
    allowedHeaders: "*",
    exposedHeaders: "*",
    maxAgeInSeconds: 3600,
  };
}

describe("mergeDocumentsCorsRules", () => {
  it("adds our origin to the duplicated mymd-only state that caused the outage", () => {
    const next = mergeDocumentsCorsRules([mymdRule(), mymdRule()], [PHYSICIAN]);

    expect(next).not.toBeNull();
    // The two mymd rules are foreign config: we widen, we never delete. Pruning is the
    // script's job, so the operator stays in control of what gets removed.
    expect(next).toHaveLength(3);
    expect(next![0]).toEqual(mymdRule());
    expect(next![1]).toEqual(mymdRule());
    expect(next![2].allowedOrigins).toBe(PHYSICIAN);
    expect(next![2].allowedMethods).toContain("PUT");
  });

  it("writes nothing when the account is already correct", () => {
    // The steady state after the fix. Zero writes means no read-modify-write race.
    const existing = [permissiveRule(`${PHYSICIAN},${DEFAULT_HOST}`)];
    expect(mergeDocumentsCorsRules(existing, [PHYSICIAN])).toBeNull();
  });

  it("leaves a superset rule alone instead of narrowing it to the configured origin", () => {
    // The regression an exact-equality check would cause: NEXT_PUBLIC_APP_URL alone yields
    // [physician], and rewriting to match would silently drop the azurewebsites fallback
    // host an operator had added by hand.
    const existing = [permissiveRule(`${PHYSICIAN}, ${DEFAULT_HOST}`)];
    expect(mergeDocumentsCorsRules(existing, [PHYSICIAN])).toBeNull();
  });

  it("widens the rule it owns rather than appending a new one", () => {
    // Appending once per domain move would walk the account into Azure's 5-rule limit.
    const existing = [permissiveRule(PHYSICIAN)];
    const next = mergeDocumentsCorsRules(existing, [PHYSICIAN, DEFAULT_HOST]);

    expect(next).toHaveLength(1);
    expect(next![0].allowedOrigins).toBe(`${PHYSICIAN},${DEFAULT_HOST}`);
  });

  it("ignores a rule that matches the origin but cannot carry the upload", () => {
    // Right origin, no PUT: the preflight would still 403, so this must not read as covered.
    const readOnly: CorsRule = { ...permissiveRule(PHYSICIAN), allowedMethods: "GET,HEAD" };
    const next = mergeDocumentsCorsRules([readOnly], [PHYSICIAN]);

    expect(next).toHaveLength(2);
    expect(next![1].allowedMethods).toContain("PUT");
  });

  it("accepts an explicit header list that happens to cover what putToAzure sends", () => {
    // The old mymd rule's header list is adequate — only its origin was wrong. If it had
    // named our origin, rewriting it would be pointless churn.
    const explicit: CorsRule = { ...mymdRule(), allowedOrigins: PHYSICIAN };
    expect(mergeDocumentsCorsRules([explicit], [PHYSICIAN])).toBeNull();
  });

  it("treats an existing wildcard origin as already covering us", () => {
    expect(mergeDocumentsCorsRules([permissiveRule("*")], [PHYSICIAN])).toBeNull();
  });

  it("matches origins case-insensitively", () => {
    const existing = [permissiveRule(PHYSICIAN.toUpperCase())];
    expect(mergeDocumentsCorsRules(existing, [PHYSICIAN])).toBeNull();
  });

  it("signals the 5-rule limit by returning an over-long array for the caller to reject", () => {
    const foreign = Array.from({ length: 5 }, (_, i) =>
      // Not adequate for us (no PUT), so none of them count as coverage.
      ({ ...permissiveRule(`https://other-${i}.example`), allowedMethods: "GET" }),
    );
    const next = mergeDocumentsCorsRules(foreign, [PHYSICIAN]);

    // applyDocumentsCors checks length > 5 and logs instead of throwing.
    expect(next).toHaveLength(6);
  });
});

describe("getDocumentsCorsOrigins", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = original.NEXT_PUBLIC_APP_URL;
    process.env.AZURE_STORAGE_CORS_EXTRA_ORIGINS = original.AZURE_STORAGE_CORS_EXTRA_ORIGINS;
  });

  it("reduces a full URL to a bare origin", () => {
    process.env.NEXT_PUBLIC_APP_URL = `${PHYSICIAN}/org/documents?x=1`;
    delete process.env.AZURE_STORAGE_CORS_EXTRA_ORIGINS;
    expect(getDocumentsCorsOrigins()).toEqual([PHYSICIAN]);
  });

  it("appends the extra-origins escape hatch and drops duplicates", () => {
    process.env.NEXT_PUBLIC_APP_URL = PHYSICIAN;
    process.env.AZURE_STORAGE_CORS_EXTRA_ORIGINS = `${DEFAULT_HOST}, ${PHYSICIAN}`;
    expect(getDocumentsCorsOrigins()).toEqual([PHYSICIAN, DEFAULT_HOST]);
  });

  it("refuses plaintext http for anything but localhost", () => {
    // A typo must not widen a PHI account's allowlist to an interceptable origin.
    process.env.NEXT_PUBLIC_APP_URL = "http://physician.health-assist.org";
    delete process.env.AZURE_STORAGE_CORS_EXTRA_ORIGINS;
    expect(getDocumentsCorsOrigins()).toEqual([]);

    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    expect(getDocumentsCorsOrigins()).toEqual(["http://localhost:3000"]);
  });

  it("drops unparseable values instead of throwing", () => {
    process.env.NEXT_PUBLIC_APP_URL = "physician.health-assist.org";
    process.env.AZURE_STORAGE_CORS_EXTRA_ORIGINS = "not a url,,   ";
    expect(getDocumentsCorsOrigins()).toEqual([]);
  });

  it("returns nothing when the app URL is unset, so the caller can warn and bail", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.AZURE_STORAGE_CORS_EXTRA_ORIGINS;
    expect(getDocumentsCorsOrigins()).toEqual([]);
  });
});
