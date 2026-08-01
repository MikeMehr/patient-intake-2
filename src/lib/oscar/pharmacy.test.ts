import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const oscarFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/oscar/client", () => ({
  oscarFetch: (...args: unknown[]) => oscarFetchMock(...args),
}));

import {
  getPharmacyBridgeConfig,
  isPharmacyUpsertEnabled,
  linkOscarPharmacy,
  listOscarPharmacies,
  upsertOscarPharmacy,
} from "@/lib/oscar/pharmacy";

const ORG = "11111111-1111-1111-1111-111111111111";
const SECRET = "s3cr3t-value-not-to-be-logged";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  queryMock.mockReset();
  oscarFetchMock.mockReset();
  process.env.OSCAR_PHARMACY_BRIDGE_SECRET = SECRET;
  delete process.env.OSCAR_PHARMACY_BRIDGE_URL;
  delete process.env.PHARMACY_BRIDGE_ALLOW_UPSERT;
  queryMock.mockResolvedValue({ rows: [{ base_url: "https://oscar.example.ca/oscar" }] });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("getPharmacyBridgeConfig", () => {
  it("derives the bridge URL from the connection's base_url origin", async () => {
    const config = await getPharmacyBridgeConfig(ORG);
    expect(config).toEqual({
      url: "https://oscar.example.ca/mymd/pharmacy-bridge",
      secret: SECRET,
    });
  });

  it("returns null when the secret is unset — 'not configured' is a normal state", async () => {
    delete process.env.OSCAR_PHARMACY_BRIDGE_SECRET;
    expect(await getPharmacyBridgeConfig(ORG)).toBeNull();
  });

  it("returns null when the org has no OSCAR connection", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    expect(await getPharmacyBridgeConfig(ORG)).toBeNull();
  });

  it("honours an explicit URL override", async () => {
    process.env.OSCAR_PHARMACY_BRIDGE_URL = "https://bridge.example.ca/hook";
    const config = await getPharmacyBridgeConfig(ORG);
    expect(config?.url).toBe("https://bridge.example.ca/hook");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects a non-https base_url", async () => {
    queryMock.mockResolvedValue({ rows: [{ base_url: "http://oscar.example.ca/oscar" }] });
    expect(await getPharmacyBridgeConfig(ORG)).toBeNull();
  });

  it("rejects a private-network base_url (SSRF guard)", async () => {
    queryMock.mockResolvedValue({ rows: [{ base_url: "https://192.168.0.201/oscar" }] });
    expect(await getPharmacyBridgeConfig(ORG)).toBeNull();
  });
});

describe("listOscarPharmacies", () => {
  it("sends the secret in the header and parses the directory", async () => {
    oscarFetchMock.mockResolvedValue(
      jsonResponse(200, {
        pharmacies: [
          {
            pharmacyId: "1",
            name: "108 STOP PHARMACY",
            address: "13444 108 Ave",
            city: "Surrey",
            province: "BC",
            postalCode: "V3T 2K1",
            phone: "604957-0711",
            fax: "604953-1700",
            email: "",
          },
        ],
      }),
    );

    const result = await listOscarPharmacies(ORG);
    expect(result).toEqual({
      pharmacies: [
        {
          pharmacyId: "1",
          name: "108 STOP PHARMACY",
          address: "13444 108 Ave",
          city: "Surrey",
          province: "BC",
          postalCode: "V3T 2K1",
          phone: "604957-0711",
          fax: "604953-1700",
          email: "",
        },
      ],
    });

    const [, options] = oscarFetchMock.mock.calls[0]!;
    expect(options.method).toBe("POST");
    expect(options.headers["X-MyMD-Pharmacy-Secret"]).toBe(SECRET);
    expect(options.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(options.body).toBe("op=list");
  });

  it("drops malformed rows rather than importing nameless pharmacies", async () => {
    oscarFetchMock.mockResolvedValue(
      jsonResponse(200, {
        pharmacies: [
          { pharmacyId: "1", name: "Real Pharmacy" },
          { pharmacyId: "2", name: "" },
          { pharmacyId: "", name: "No id" },
          null,
        ],
      }),
    );
    const result = await listOscarPharmacies(ORG);
    expect("pharmacies" in result && result.pharmacies).toHaveLength(1);
  });

  it("returns a structured error when the payload has no list", async () => {
    oscarFetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    expect(await listOscarPharmacies(ORG)).toEqual({
      error: "Pharmacy bridge returned no pharmacy list",
      status: 502,
    });
  });
});

describe("linkOscarPharmacy", () => {
  it("posts op=link and reports success", async () => {
    oscarFetchMock.mockResolvedValue(jsonResponse(200, { ok: true, pharmacyId: "1449" }));
    expect(await linkOscarPharmacy(ORG, { demographicNo: "46", pharmacyId: "1449" })).toEqual({
      ok: true,
    });
    const [, options] = oscarFetchMock.mock.calls[0]!;
    expect(options.body).toBe("op=link&demographicNo=46&pharmacyId=1449");
    // The patient is waiting on this call, so it must not inherit the 20 s default.
    expect(options.timeoutMs).toBe(8_000);
  });

  it("rejects non-numeric ids before anything leaves the app", async () => {
    expect(await linkOscarPharmacy(ORG, { demographicNo: "46; DROP", pharmacyId: "1" })).toEqual({
      error: "demographicNo and pharmacyId must be numeric",
      status: 400,
    });
    expect(oscarFetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the bridge's own error on a non-2xx without throwing", async () => {
    oscarFetchMock.mockResolvedValue(jsonResponse(404, { error: "demographic not found" }));
    expect(await linkOscarPharmacy(ORG, { demographicNo: "999", pharmacyId: "1" })).toEqual({
      error: "demographic not found",
      status: 404,
    });
  });

  it("returns a structured error when the bridge is unreachable", async () => {
    oscarFetchMock.mockRejectedValue(new Error("Oscar request timed out after 8000ms"));
    const result = await linkOscarPharmacy(ORG, { demographicNo: "46", pharmacyId: "1" });
    expect(result).toEqual({
      error: "Could not reach the clinic's pharmacy bridge",
      status: 503,
    });
  });

  it("returns a structured error when the bridge is not configured", async () => {
    delete process.env.OSCAR_PHARMACY_BRIDGE_SECRET;
    expect(await linkOscarPharmacy(ORG, { demographicNo: "46", pharmacyId: "1" })).toEqual({
      error: "Pharmacy bridge is not configured for this clinic",
      status: 503,
    });
    expect(oscarFetchMock).not.toHaveBeenCalled();
  });

  it("handles a non-JSON response", async () => {
    oscarFetchMock.mockResolvedValue(new Response("<html>502</html>", { status: 502 }));
    expect(await linkOscarPharmacy(ORG, { demographicNo: "46", pharmacyId: "1" })).toEqual({
      error: "Pharmacy bridge returned an unexpected response",
      status: 502,
    });
  });

  it("never writes the secret to the log", async () => {
    oscarFetchMock.mockRejectedValue(new Error(`boom ${SECRET}`));
    await linkOscarPharmacy(ORG, { demographicNo: "46", pharmacyId: "1" });
    oscarFetchMock.mockResolvedValue(jsonResponse(500, { error: "internal error" }));
    await linkOscarPharmacy(ORG, { demographicNo: "46", pharmacyId: "1" });

    const logged = errorSpy.mock.calls.flat().map(String).join(" ");
    // The thrown message itself is echoed by design; what must never appear is the config we hold.
    expect(logged).not.toContain("X-MyMD-Pharmacy-Secret");
    const configLeaks = errorSpy.mock.calls
      .flat()
      .filter((arg: unknown) => typeof arg === "object" && arg !== null && "secret" in (arg as object));
    expect(configLeaks).toHaveLength(0);
  });
});

describe("upsertOscarPharmacy", () => {
  it("returns the new pharmacy id", async () => {
    oscarFetchMock.mockResolvedValue(jsonResponse(200, { pharmacyId: "1600", created: true }));
    expect(await upsertOscarPharmacy(ORG, { name: "Corner Pharmacy", city: "Burnaby" })).toEqual({
      pharmacyId: "1600",
    });
  });

  it("requires a name", async () => {
    expect(await upsertOscarPharmacy(ORG, { name: "  " })).toEqual({
      error: "name is required",
      status: 400,
    });
    expect(oscarFetchMock).not.toHaveBeenCalled();
  });

  it("errors when the bridge returns no id", async () => {
    oscarFetchMock.mockResolvedValue(jsonResponse(200, { created: true }));
    expect(await upsertOscarPharmacy(ORG, { name: "Corner Pharmacy" })).toEqual({
      error: "Pharmacy bridge did not return a pharmacy id",
      status: 502,
    });
  });
});

describe("isPharmacyUpsertEnabled", () => {
  it("is off unless explicitly enabled", () => {
    expect(isPharmacyUpsertEnabled()).toBe(false);
    process.env.PHARMACY_BRIDGE_ALLOW_UPSERT = "1";
    expect(isPharmacyUpsertEnabled()).toBe(false);
    process.env.PHARMACY_BRIDGE_ALLOW_UPSERT = "true";
    expect(isPharmacyUpsertEnabled()).toBe(true);
  });
});
