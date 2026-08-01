import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const getClinicBySlugMock = vi.hoisted(() => vi.fn());
const searchPharmacyDirectoryMock = vi.hoisted(() => vi.fn());
const getPharmacyDirectoryStateMock = vi.hoisted(() => vi.fn());
const shouldRefreshDirectoryMock = vi.hoisted(() => vi.fn());
const syncPharmacyDirectoryForOrgMock = vi.hoisted(() => vi.fn());
const afterMock = vi.hoisted(() => vi.fn());

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: (...args: unknown[]) => afterMock(...args) };
});

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/booking-store", () => ({
  getClinicBySlug: (...args: unknown[]) => getClinicBySlugMock(...args),
}));

vi.mock("@/lib/pharmacy-directory", () => ({
  searchPharmacyDirectory: (...args: unknown[]) => searchPharmacyDirectoryMock(...args),
  getPharmacyDirectoryState: (...args: unknown[]) => getPharmacyDirectoryStateMock(...args),
  shouldRefreshDirectory: (...args: unknown[]) => shouldRefreshDirectoryMock(...args),
  syncPharmacyDirectoryForOrg: (...args: unknown[]) => syncPharmacyDirectoryForOrgMock(...args),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

const ORG = "11111111-1111-1111-1111-111111111111";

function makeRequest(q: string, withCookie = true): NextRequest {
  const req = new NextRequest(
    `https://booking.test/api/booking/mymd/pharmacy-search?q=${encodeURIComponent(q)}`,
  );
  if (withCookie) req.cookies.set("booking_hold_key", "hold-key-1");
  return req;
}

const params = Promise.resolve({ clinicSlug: "mymd" });

beforeEach(() => {
  queryMock.mockReset().mockResolvedValue({ rows: [{ id: "slot-1" }] });
  getClinicBySlugMock.mockReset().mockResolvedValue({
    id: ORG,
    settings: { onlineBookingEnabled: true },
  });
  searchPharmacyDirectoryMock.mockReset().mockResolvedValue([]);
  getPharmacyDirectoryStateMock.mockReset().mockResolvedValue({
    count: 1516,
    lastSuccessAt: new Date(),
    lastAttemptAt: new Date(),
    lastStatus: "OK",
    lastError: null,
  });
  shouldRefreshDirectoryMock.mockReset().mockReturnValue(false);
  syncPharmacyDirectoryForOrgMock.mockReset();
  afterMock.mockReset();
});

describe("GET /api/booking/[clinicSlug]/pharmacy-search", () => {
  it("rejects a request with no booking hold cookie", async () => {
    const res = await GET(makeRequest("shoppers", false), { params });
    expect(res.status).toBe(403);
    expect(searchPharmacyDirectoryMock).not.toHaveBeenCalled();
  });

  it("rejects when the hold does not belong to this clinic", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const res = await GET(makeRequest("shoppers"), { params });
    expect(res.status).toBe(403);
    expect(searchPharmacyDirectoryMock).not.toHaveBeenCalled();
  });

  it("404s for an unknown clinic", async () => {
    getClinicBySlugMock.mockResolvedValue(null);
    const res = await GET(makeRequest("shoppers"), { params });
    expect(res.status).toBe(404);
  });

  it("404s when online booking is disabled", async () => {
    getClinicBySlugMock.mockResolvedValue({ id: ORG, settings: { onlineBookingEnabled: false } });
    const res = await GET(makeRequest("shoppers"), { params });
    expect(res.status).toBe(404);
  });

  it("reports an empty directory instead of an empty result list", async () => {
    getPharmacyDirectoryStateMock.mockResolvedValue({
      count: 0,
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastStatus: null,
      lastError: null,
    });
    const res = await GET(makeRequest("shoppers"), { params });
    expect(await res.json()).toEqual({ pharmacies: [], directoryEmpty: true });
    expect(searchPharmacyDirectoryMock).not.toHaveBeenCalled();
  });

  it("returns matches scoped to the clinic's organization", async () => {
    searchPharmacyDirectoryMock.mockResolvedValue([
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
    const res = await GET(makeRequest("wal"), { params });
    expect(await res.json()).toEqual({
      pharmacies: [
        {
          id: "1449",
          name: "WAL-MART PHARMACY #1213",
          address: "1000 Main St",
          city: "Surrey",
          phone: "6049570711",
          fax: "6049531700",
        },
      ],
      directoryEmpty: false,
    });
    expect(searchPharmacyDirectoryMock).toHaveBeenCalledWith(ORG, "wal");
  });

  it("caps an over-long query rather than passing it through", async () => {
    await GET(makeRequest("x".repeat(500)), { params });
    expect(searchPharmacyDirectoryMock.mock.calls[0]![1]).toHaveLength(100);
  });

  it("schedules a background refresh when the directory is stale, without awaiting it", async () => {
    shouldRefreshDirectoryMock.mockReturnValue(true);
    await GET(makeRequest("wal"), { params });
    expect(afterMock).toHaveBeenCalledTimes(1);
    // The sync itself must not run inline — the patient is typing.
    expect(syncPharmacyDirectoryForOrgMock).not.toHaveBeenCalled();
  });

  it("fails soft so a broken search can never block a booking", async () => {
    searchPharmacyDirectoryMock.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest("wal"), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pharmacies: [], directoryEmpty: true });
  });
});
