import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getAllowedLaunchOrigins, resolveAllowedOpenerOrigin } from "./launch-origins";

function setEnv(value: string | undefined, nodeEnv = "test") {
  vi.stubEnv("OSCAR_LAUNCH_ALLOWED_ORIGINS", value as string);
  vi.stubEnv("NODE_ENV", nodeEnv);
}

beforeEach(() => setEnv("https://oscar.mymdonline.ca"));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getAllowedLaunchOrigins", () => {
  it("parses a single origin", () => {
    expect(getAllowedLaunchOrigins()).toEqual(["https://oscar.mymdonline.ca"]);
  });

  it("parses and dedupes a comma-separated list, ignoring whitespace", () => {
    setEnv(" https://a.example.com , https://b.example.com ,https://a.example.com ");
    expect(getAllowedLaunchOrigins()).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  it("normalises trailing slashes, paths and hostname case", () => {
    setEnv("https://OSCAR.MyMDonline.ca/, https://oscar.mymdonline.ca/some/path");
    expect(getAllowedLaunchOrigins()).toEqual(["https://oscar.mymdonline.ca"]);
  });

  it("returns an empty list when unset or unusable", () => {
    setEnv(undefined);
    expect(getAllowedLaunchOrigins()).toEqual([]);
    setEnv("");
    expect(getAllowedLaunchOrigins()).toEqual([]);
    setEnv("not-a-url, ftp://x.example.com");
    expect(getAllowedLaunchOrigins()).toEqual([]);
  });

  it("allows http only outside production", () => {
    setEnv("http://oscar.test:8080", "development");
    expect(getAllowedLaunchOrigins()).toEqual(["http://oscar.test:8080"]);
    setEnv("http://oscar.test:8080", "production");
    expect(getAllowedLaunchOrigins()).toEqual([]);
  });
});

describe("resolveAllowedOpenerOrigin", () => {
  it("returns the sole configured origin when none is requested", () => {
    expect(resolveAllowedOpenerOrigin()).toBe("https://oscar.mymdonline.ca");
    expect(resolveAllowedOpenerOrigin(null)).toBe("https://oscar.mymdonline.ca");
    expect(resolveAllowedOpenerOrigin("")).toBe("https://oscar.mymdonline.ca");
  });

  it("returns an exact match when requested", () => {
    expect(resolveAllowedOpenerOrigin("https://oscar.mymdonline.ca")).toBe(
      "https://oscar.mymdonline.ca",
    );
    expect(resolveAllowedOpenerOrigin("https://oscar.mymdonline.ca/")).toBe(
      "https://oscar.mymdonline.ca",
    );
  });

  it("rejects suffix and prefix lookalikes", () => {
    // The whole reason this uses exact equality rather than endsWith.
    expect(resolveAllowedOpenerOrigin("https://oscar.mymdonline.ca.evil.com")).toBeNull();
    expect(resolveAllowedOpenerOrigin("https://evil.com/oscar.mymdonline.ca")).toBeNull();
    expect(resolveAllowedOpenerOrigin("https://notoscar.mymdonline.ca")).toBeNull();
    expect(resolveAllowedOpenerOrigin("https://oscar.mymdonline.ca:8443")).toBeNull();
  });

  it("rejects a scheme downgrade in production", () => {
    setEnv("https://oscar.mymdonline.ca", "production");
    expect(resolveAllowedOpenerOrigin("http://oscar.mymdonline.ca")).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(resolveAllowedOpenerOrigin("not-a-url")).toBeNull();
    expect(resolveAllowedOpenerOrigin("javascript:alert(1)")).toBeNull();
    expect(resolveAllowedOpenerOrigin("*")).toBeNull();
  });

  it("returns null when nothing is configured", () => {
    setEnv(undefined);
    expect(resolveAllowedOpenerOrigin("https://oscar.mymdonline.ca")).toBeNull();
    expect(resolveAllowedOpenerOrigin()).toBeNull();
  });

  it("requires an explicit request when several origins are configured", () => {
    setEnv("https://a.example.com,https://b.example.com");
    // Ambiguous — refusing is the safe answer, since guessing could send PHI
    // to the wrong clinic's OSCAR.
    expect(resolveAllowedOpenerOrigin()).toBeNull();
    expect(resolveAllowedOpenerOrigin("https://b.example.com")).toBe("https://b.example.com");
  });
});
