import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const getClientMock = vi.hoisted(() => vi.fn());
const listOscarPharmaciesMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
  getClient: (...args: unknown[]) => getClientMock(...args),
}));

vi.mock("@/lib/oscar/pharmacy", () => ({
  listOscarPharmacies: (...args: unknown[]) => listOscarPharmaciesMock(...args),
}));

import {
  findPharmacyByNameCity,
  getPharmacyFromDirectory,
  searchPharmacyDirectory,
  shouldRefreshDirectory,
  syncPharmacyDirectoryForOrg,
  tokenizeQuery,
} from "@/lib/pharmacy-directory";

const ORG = "11111111-1111-1111-1111-111111111111";

function makeClient() {
  const clientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  return { query: clientQuery, release: vi.fn() };
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  queryMock.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  getClientMock.mockReset();
  listOscarPharmaciesMock.mockReset();
  delete process.env.PHARMACY_DIRECTORY_MAX_AGE_DAYS;
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("tokenizeQuery", () => {
  it("splits a name-plus-city query into independent words", () => {
    // The reported bug: this returned nothing as a single contiguous LIKE, because the name and
    // the city are never adjacent in search_text.
    expect(tokenizeQuery("shoppers drug mart, burnaby")).toEqual([
      "shoppers",
      "drug",
      "mart",
      "burnaby",
    ]);
  });

  it("drops punctuation and keeps store numbers", () => {
    expect(tokenizeQuery("Shoppers Drug Mart #2127")).toEqual([
      "shoppers",
      "drug",
      "mart",
      "2127",
    ]);
    expect(tokenizeQuery("St. Paul's Pharmacy")).toEqual(["st", "paul", "pharmacy"]);
  });

  it("drops single characters, which match almost everything", () => {
    expect(tokenizeQuery("a b shoppers")).toEqual(["shoppers"]);
  });

  it("caps the number of words so one query cannot build unbounded SQL", () => {
    expect(tokenizeQuery("aa bb cc dd ee ff gg hh ii")).toHaveLength(6);
  });

  it("returns nothing usable for empty or punctuation-only input", () => {
    expect(tokenizeQuery("   ")).toEqual([]);
    expect(tokenizeQuery(",,, ###")).toEqual([]);
    expect(tokenizeQuery("s")).toEqual([]);
  });
});

describe("searchPharmacyDirectory", () => {
  it("short-circuits when no usable word remains, without touching the database", async () => {
    expect(await searchPharmacyDirectory(ORG, "s")).toEqual([]);
    expect(await searchPharmacyDirectory(ORG, "  ")).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("ANDs one LIKE per word so name and city both have to match", async () => {
    await searchPharmacyDirectory(ORG, "shoppers drug mart, burnaby");
    const [sql, params] = queryMock.mock.calls[0]!;

    expect(sql).toContain(
      "search_text LIKE $2 ESCAPE '\\' AND search_text LIKE $3 ESCAPE '\\' " +
        "AND search_text LIKE $4 ESCAPE '\\' AND search_text LIKE $5 ESCAPE '\\'",
    );
    expect(params.slice(0, 5)).toEqual([
      ORG,
      "%shoppers%",
      "%drug%",
      "%mart%",
      "%burnaby%",
    ]);
    // The limit is always the last placeholder, whatever the word count.
    expect(params[params.length - 1]).toBe(10);
    expect(sql).toContain(`LIMIT $${params.length}`);
  });

  it("lower-cases words to match the stored search_text", async () => {
    await searchPharmacyDirectory(ORG, "SHOPPERS");
    const [, params] = queryMock.mock.calls[0]!;
    expect(params[1]).toBe("%shoppers%");
  });

  it("cannot be turned into a match-everything query by wildcards", async () => {
    // Tokenizing strips % and _ entirely; the ESCAPE clause is belt-and-braces.
    expect(await searchPharmacyDirectory(ORG, "%%")).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();

    await searchPharmacyDirectory(ORG, "a_b%cd");
    const [, params] = queryMock.mock.calls[0]!;
    expect(params.slice(1, -1)).toEqual(["%cd%"]);
  });

  it("maps snake_case rows to the camelCase shape", async () => {
    queryMock.mockResolvedValue({
      rows: [
        {
          oscar_pharmacy_id: "1449",
          name: "WAL-MART PHARMACY #1213",
          address: "1000 Main St",
          city: "Surrey",
          province: "BC",
          postal_code: "V3T 2K1",
          phone: "6049570711",
          fax: "6049531700",
        },
      ],
    });
    expect(await searchPharmacyDirectory(ORG, "wal")).toEqual([
      {
        oscarPharmacyId: "1449",
        name: "WAL-MART PHARMACY #1213",
        address: "1000 Main St",
        city: "Surrey",
        province: "BC",
        postalCode: "V3T 2K1",
        phone: "6049570711",
        fax: "6049531700",
      },
    ]);
  });
});

describe("getPharmacyFromDirectory", () => {
  it("scopes the lookup to the organization and active rows", async () => {
    await getPharmacyFromDirectory(ORG, "1449");
    const [sql, params] = queryMock.mock.calls[0]!;
    expect(sql).toContain("organization_id = $1");
    expect(sql).toContain("active = TRUE");
    expect(params).toEqual([ORG, "1449"]);
  });

  it("returns null for an unknown id", async () => {
    expect(await getPharmacyFromDirectory(ORG, "999999")).toBeNull();
  });
});

describe("findPharmacyByNameCity", () => {
  it("returns null for a blank name without querying", async () => {
    expect(await findPharmacyByNameCity(ORG, "   ")).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("passes null for city when none is supplied so the filter is skipped", async () => {
    await findPharmacyByNameCity(ORG, "Corner Pharmacy");
    const [, params] = queryMock.mock.calls[0]!;
    expect(params).toEqual([ORG, "Corner Pharmacy", null]);
  });
});

describe("syncPharmacyDirectoryForOrg", () => {
  it("upserts the directory and deactivates rows the pull didn't touch", async () => {
    const client = makeClient();
    getClientMock.mockResolvedValue(client);
    client.query.mockImplementation((sql: string) =>
      sql.startsWith("UPDATE") ? { rows: [], rowCount: 3 } : { rows: [], rowCount: 0 },
    );
    listOscarPharmaciesMock.mockResolvedValue({
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

    expect(await syncPharmacyDirectoryForOrg(ORG)).toEqual({ synced: 1, deactivated: 3 });

    const statements = client.query.mock.calls.map((c) => String(c[0]));
    expect(statements[0]).toBe("BEGIN");
    expect(statements.at(-1)).toBe("COMMIT");
    expect(statements.some((s) => s.includes("ON CONFLICT (organization_id, oscar_pharmacy_id)"))).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });

  it("refuses to deactivate anything when the bridge returns an empty directory", async () => {
    listOscarPharmaciesMock.mockResolvedValue({ pharmacies: [] });

    const result = await syncPharmacyDirectoryForOrg(ORG);
    expect("error" in result && result.status).toBe(502);
    // The whole point: no transaction is opened, so nothing can be deactivated.
    expect(getClientMock).not.toHaveBeenCalled();

    const statusWrite = queryMock.mock.calls.find((c) => String(c[0]).includes("last_status"));
    expect(statusWrite?.[1]?.[1]).toBe("FAILED");
  });

  it("records a FAILED attempt when the bridge errors, and does not open a transaction", async () => {
    listOscarPharmaciesMock.mockResolvedValue({ error: "Could not reach the bridge", status: 503 });

    const result = await syncPharmacyDirectoryForOrg(ORG);
    expect("error" in result && result.status).toBe(503);
    expect(getClientMock).not.toHaveBeenCalled();

    const statusWrite = queryMock.mock.calls.find((c) => String(c[0]).includes("last_status"));
    expect(statusWrite?.[1]?.[1]).toBe("FAILED");
    expect(statusWrite?.[1]?.[2]).toBe("Could not reach the bridge");
  });

  it("records the attempt before calling the bridge, so a hang still leaves a trace", async () => {
    listOscarPharmaciesMock.mockResolvedValue({ error: "boom", status: 503 });
    await syncPharmacyDirectoryForOrg(ORG);
    expect(String(queryMock.mock.calls[0]![0])).toContain("last_attempt_at");
  });

  it("rolls back and records FAILED when the database write throws", async () => {
    const client = makeClient();
    getClientMock.mockResolvedValue(client);
    client.query.mockImplementation((sql: string) => {
      if (String(sql).startsWith("INSERT INTO pharmacy_directory")) throw new Error("deadlock");
      return { rows: [], rowCount: 0 };
    });
    listOscarPharmaciesMock.mockResolvedValue({
      pharmacies: [{ pharmacyId: "1", name: "A", address: "", city: "", province: "", postalCode: "", phone: "", fax: "", email: "" }],
    });

    const result = await syncPharmacyDirectoryForOrg(ORG);
    expect("error" in result && result.status).toBe(500);
    expect(client.query.mock.calls.map((c) => String(c[0]))).toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalled();
  });
});

describe("shouldRefreshDirectory", () => {
  const base = { lastStatus: null, lastError: null, count: 0 };

  it("refreshes when the directory has never synced", () => {
    expect(
      shouldRefreshDirectory({ ...base, lastSuccessAt: null, lastAttemptAt: null }),
    ).toBe(true);
  });

  it("does not refresh when another request attempted one in the last five minutes", () => {
    expect(
      shouldRefreshDirectory({
        ...base,
        lastSuccessAt: null,
        lastAttemptAt: new Date(Date.now() - 60_000),
      }),
    ).toBe(false);
  });

  it("does not refresh a directory synced within the max age", () => {
    expect(
      shouldRefreshDirectory({
        ...base,
        lastSuccessAt: new Date(Date.now() - 24 * 60 * 60_000),
        lastAttemptAt: new Date(Date.now() - 24 * 60 * 60_000),
      }),
    ).toBe(false);
  });

  it("refreshes once the directory is older than the max age", () => {
    process.env.PHARMACY_DIRECTORY_MAX_AGE_DAYS = "7";
    expect(
      shouldRefreshDirectory({
        ...base,
        lastSuccessAt: new Date(Date.now() - 8 * 24 * 60 * 60_000),
        lastAttemptAt: new Date(Date.now() - 8 * 24 * 60 * 60_000),
      }),
    ).toBe(true);
  });
});
