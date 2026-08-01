/**
 * confirmAppointment builds a hand-written CTE with 22 positional placeholders. Adding the seven
 * pharmacy columns is exactly the kind of change that silently shifts a parameter by one and
 * writes the fax number into the city column, so the ordering is pinned here.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
  getClient: vi.fn(),
}));

vi.mock("@/lib/encrypted-field", () => ({
  encryptString: (v: string) => `enc:${v}`,
  decryptString: (v: string) => v,
}));

import { confirmAppointment } from "@/lib/booking-store";

const SLOT = "slot-1";
const ORG = "11111111-1111-1111-1111-111111111111";
const KEY = "hold-key-1";

const BASE = {
  firstName: "Ali",
  lastName: "Test",
  dateOfBirth: "1988-04-15",
  email: "ali@example.com",
  coverageType: "CANADIAN_HEALTH_CARD",
  province: "British Columbia",
  healthCardNumber: "9999999999",
  billingNote: undefined,
  reason: "Sore throat",
  manageTokenHash: "hash-token",
  manageTokenExpiresAt: new Date("2026-09-01T00:00:00Z"),
  oscarDemographicNo: "46",
};

beforeEach(() => {
  queryMock.mockReset().mockResolvedValue({
    rows: [{ appointment_id: "appt-1", physician_id: "phys-1" }],
  });
});

describe("confirmAppointment parameter ordering", () => {
  it("places the pharmacy columns at $16–$22 in the documented order", async () => {
    await confirmAppointment(SLOT, ORG, KEY, {
      ...BASE,
      pharmacy: {
        oscarPharmacyId: "1449",
        name: "WAL-MART PHARMACY #1213",
        address: "1000 Main St",
        city: "Surrey",
        phone: "6049570711",
        fax: "6049531700",
        source: "DIRECTORY",
      },
    });

    const [sql, params] = queryMock.mock.calls[0]!;

    // The column list and the SELECT list must agree, and both must match the params array.
    expect(sql).toContain(
      "pharmacy_oscar_id, pharmacy_name, pharmacy_address, pharmacy_city,\n          pharmacy_phone, pharmacy_fax, pharmacy_source",
    );
    expect(sql).toContain("$16, $17, $18, $19, $20, $21, $22");

    expect(params).toHaveLength(22);
    // $1–$15 unchanged.
    expect(params.slice(0, 15)).toEqual([
      SLOT,
      ORG,
      KEY,
      "Ali",
      "Test",
      "1988-04-15",
      "ali@example.com",
      "CANADIAN_HEALTH_CARD",
      "British Columbia",
      "enc:9999999999",
      null,
      "Sore throat",
      "hash-token",
      "2026-09-01T00:00:00.000Z",
      "46",
    ]);
    // $16–$22, positionally.
    expect(params.slice(15)).toEqual([
      "1449",
      "WAL-MART PHARMACY #1213",
      "1000 Main St",
      "Surrey",
      "6049570711",
      "6049531700",
      "DIRECTORY",
    ]);
  });

  it("writes NULLs for every pharmacy column when none was chosen", async () => {
    await confirmAppointment(SLOT, ORG, KEY, BASE);
    const [, params] = queryMock.mock.calls[0]!;
    expect(params).toHaveLength(22);
    expect(params.slice(15)).toEqual([null, null, null, null, null, null, null]);
  });

  it("writes a NULL pharmacy id for free text, keeping the name and source", async () => {
    await confirmAppointment(SLOT, ORG, KEY, {
      ...BASE,
      pharmacy: { name: "Corner Pharmacy", city: "Burnaby", source: "FREE_TEXT" },
    });
    const [, params] = queryMock.mock.calls[0]!;
    expect(params.slice(15)).toEqual([
      null,
      "Corner Pharmacy",
      null,
      "Burnaby",
      null,
      null,
      "FREE_TEXT",
    ]);
  });

  it("still maps a duplicate-slot violation to null rather than throwing", async () => {
    queryMock.mockRejectedValue(Object.assign(new Error("dup"), { code: "23505" }));
    expect(await confirmAppointment(SLOT, ORG, KEY, BASE)).toBeNull();
  });
});
