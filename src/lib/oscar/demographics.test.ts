import { describe, it, expect, vi, beforeEach } from "vitest";

const oscarSignedFetch = vi.fn();
vi.mock("@/lib/oscar/client", () => ({
  oscarSignedFetch: (...args: unknown[]) => oscarSignedFetch(...args),
}));

import { fetchOscarDemographic, normalizeOscarDemographic } from "./demographics";
import type { OscarCreds } from "./self-serve";

const CREDS: OscarCreds = {
  client_key: "key",
  clientSecret: "secret",
  accessToken: "token",
  tokenSecret: "tokenSecret",
  restBase: "https://oscar.example.com/oscar/ws/services",
};

function respond(body: unknown, ok = true, status = 200) {
  oscarSignedFetch.mockResolvedValueOnce({
    ok,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
}

beforeEach(() => oscarSignedFetch.mockReset());

describe("normalizeOscarDemographic — date of birth", () => {
  // Regression coverage for the bug this module was extracted to fix: the old
  // inline route read details.dob ?? details.dateOfBirth ?? details.birthDate
  // raw, so each of these produced a wrong value.
  it("normalizes a plain ISO date", () => {
    expect(normalizeOscarDemographic("46", { dob: "1981-09-16" }).dateOfBirth).toBe("1981-09-16");
  });

  it("normalizes a Java Date-ish string with a time suffix", () => {
    expect(normalizeOscarDemographic("46", { dob: "1981-09-16 00:00:00" }).dateOfBirth).toBe(
      "1981-09-16",
    );
  });

  it("normalizes an ISO datetime with an offset", () => {
    expect(normalizeOscarDemographic("46", { dateOfBirth: "1981-09-16T00:00:00.000-07:00" }).dateOfBirth).toBe(
      "1981-09-16",
    );
  });

  it("normalizes epoch milliseconds", () => {
    expect(normalizeOscarDemographic("46", { dob: Date.UTC(1981, 8, 16) }).dateOfBirth).toBe(
      "1981-09-16",
    );
  });

  it("reconstructs from OSCAR's split components", () => {
    // THE important case: DemographicTo1 puts day-of-month in `dateOfBirth`.
    // The old code returned "16" here.
    const out = normalizeOscarDemographic("46", {
      yearOfBirth: "1981",
      monthOfBirth: "09",
      dateOfBirth: "16",
    });
    expect(out.dateOfBirth).toBe("1981-09-16");
  });

  it("returns null rather than a day-of-month when the year and month are missing", () => {
    expect(normalizeOscarDemographic("46", { dateOfBirth: "16" }).dateOfBirth).toBeNull();
  });
});

describe("normalizeOscarDemographic — other fields", () => {
  it("maps name, phone, HIN, email and address across deployment variants", () => {
    const out = normalizeOscarDemographic("46", {
      firstName: "ALI",
      lastName: "TEST",
      phone: " 604-555-0101 ",
      phone2: "604-555-0102",
      hin: "9999999999",
      email: "Ali.Test@Example.COM",
      streetNumber: "123",
      streetName: "Main St",
      city: "Vancouver",
      province: "BC",
      postal: "V6A 1A1",
    });
    expect(out).toMatchObject({
      demographicNo: "46",
      firstName: "ALI",
      lastName: "TEST",
      primaryPhone: "604-555-0101",
      secondaryPhone: "604-555-0102",
      insuranceNumber: "9999999999",
    });
    expect(out.patientEmail).toBe("ali.test@example.com");
    expect(out.patientAddress).toBe("123 Main St, Vancouver, BC, V6A 1A1");
  });

  it("returns nulls for an empty record rather than empty strings", () => {
    const out = normalizeOscarDemographic("46", {});
    expect(out.firstName).toBeNull();
    expect(out.lastName).toBeNull();
    expect(out.dateOfBirth).toBeNull();
    expect(out.patientEmail).toBeNull();
    expect(out.patientAddress).toBeNull();
  });
});

describe("fetchOscarDemographic", () => {
  it("signs a GET to /demographics/{no} and returns the normalized record", async () => {
    respond({ firstName: "ALI", lastName: "TEST", dob: "1981-09-16" });
    const result = await fetchOscarDemographic(CREDS, "46");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.demographic.dateOfBirth).toBe("1981-09-16");
    expect(oscarSignedFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: "https://oscar.example.com/oscar/ws/services/demographics/46",
      }),
    );
  });

  it("URL-encodes the demographic number", async () => {
    respond({});
    await fetchOscarDemographic(CREDS, "4 6/../x");
    expect(oscarSignedFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://oscar.example.com/oscar/ws/services/demographics/4%206%2F..%2Fx",
      }),
    );
  });

  it("reports not_found on 404", async () => {
    respond("no such demographic", false, 404);
    const result = await fetchOscarDemographic(CREDS, "999999");
    expect(result).toMatchObject({ ok: false, reason: "not_found", status: 404 });
  });

  it("reports oscar_error on other failures", async () => {
    respond("nope", false, 401);
    const result = await fetchOscarDemographic(CREDS, "46");
    expect(result).toMatchObject({ ok: false, reason: "oscar_error", status: 401 });
  });

  it("reports bad_response on non-JSON and on non-object JSON", async () => {
    respond("<html>login</html>");
    expect(await fetchOscarDemographic(CREDS, "46")).toMatchObject({
      ok: false,
      reason: "bad_response",
    });
    respond("[1,2,3]");
    expect(await fetchOscarDemographic(CREDS, "46")).toMatchObject({
      ok: false,
      reason: "bad_response",
    });
  });

  it("turns a network throw into a result instead of propagating", async () => {
    oscarSignedFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await fetchOscarDemographic(CREDS, "46");
    expect(result).toMatchObject({ ok: false, reason: "oscar_error", status: 503 });
  });
});
