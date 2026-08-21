/**
 * The pharmacy link is best-effort by design: it runs after the booking is committed and may only
 * annotate it. These tests pin that contract — a broken bridge must never change what the patient
 * sees, and a booking with no pharmacy must not touch the pharmacy code at all.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const confirmAppointmentMock = vi.hoisted(() => vi.fn());
const getClinicBySlugMock = vi.hoisted(() => vi.fn());
const getPhysiciansForBookingMock = vi.hoisted(() => vi.fn());
const getSlotPhysicianIdMock = vi.hoisted(() => vi.fn());
const physicianSupportsVideoMock = vi.hoisted(() => vi.fn());
const linkOscarPharmacyMock = vi.hoisted(() => vi.fn());
const upsertOscarPharmacyMock = vi.hoisted(() => vi.fn());
const isPharmacyUpsertEnabledMock = vi.hoisted(() => vi.fn());
const getPharmacyFromDirectoryMock = vi.hoisted(() => vi.fn());
const findPharmacyByNameCityMock = vi.hoisted(() => vi.fn());
const createOscarAppointmentMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ query: (...a: unknown[]) => queryMock(...a) }));

vi.mock("@/lib/booking-store", () => ({
  confirmAppointment: (...a: unknown[]) => confirmAppointmentMock(...a),
  getClinicBySlug: (...a: unknown[]) => getClinicBySlugMock(...a),
  getPhysiciansForBooking: (...a: unknown[]) => getPhysiciansForBookingMock(...a),
  getSlotPhysicianId: (...a: unknown[]) => getSlotPhysicianIdMock(...a),
  physicianSupportsVideo: (...a: unknown[]) => physicianSupportsVideoMock(...a),
}));

vi.mock("@/lib/booking-token", () => ({
  generateManageToken: () => ({
    raw: "raw-token",
    hash: "hash-token",
    expiresAt: new Date("2026-09-01T00:00:00Z"),
  }),
}));

vi.mock("@/lib/booking-email", () => ({ sendBookingConfirmation: vi.fn(async () => {}) }));
vi.mock("@/lib/sms", () => ({ sendBookingAlertSMS: vi.fn(async () => {}) }));
vi.mock("@/lib/physician-lookup", () => ({ getPhysicianPhone: vi.fn(async () => null) }));
vi.mock("@/lib/encrypted-field", () => ({
  encryptString: (v: string) => `enc:${v}`,
  decryptString: (v: string) => v,
}));

vi.mock("@/lib/oscar/appointments", () => ({
  createOscarAppointment: (...a: unknown[]) => createOscarAppointmentMock(...a),
  toClinicLocalParts: () => ({ date: "2026-08-10", time: "09:00" }),
}));

vi.mock("@/lib/oscar/pharmacy", () => ({
  linkOscarPharmacy: (...a: unknown[]) => linkOscarPharmacyMock(...a),
  upsertOscarPharmacy: (...a: unknown[]) => upsertOscarPharmacyMock(...a),
  isPharmacyUpsertEnabled: (...a: unknown[]) => isPharmacyUpsertEnabledMock(...a),
}));

vi.mock("@/lib/pharmacy-directory", () => ({
  getPharmacyFromDirectory: (...a: unknown[]) => getPharmacyFromDirectoryMock(...a),
  findPharmacyByNameCity: (...a: unknown[]) => findPharmacyByNameCityMock(...a),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

const ORG = "11111111-1111-1111-1111-111111111111";

const DIRECTORY_ROW = {
  oscarPharmacyId: "1449",
  name: "WAL-MART PHARMACY #1213",
  address: "1000 Main St",
  city: "Surrey",
  province: "BC",
  postalCode: "V3T 2K1",
  phone: "6049570711",
  fax: "6049531700",
};

function makeRequest(extra: Record<string, unknown> = {}): NextRequest {
  const req = new NextRequest("https://booking.test/api/booking/mymd/confirm", {
    method: "POST",
    body: JSON.stringify({
      slotId: "slot-1",
      firstName: "Ali",
      lastName: "Test",
      dateOfBirth: "1988-04-15",
      email: "ali@example.com",
      reason: "Sore throat",
      coverageType: "CANADIAN_HEALTH_CARD",
      consentGiven: true,
      oscarDemographicNo: "46",
      ...extra,
    }),
    headers: { "Content-Type": "application/json" },
  });
  req.cookies.set("booking_hold_key", "hold-key-1");
  return req;
}

const params = Promise.resolve({ clinicSlug: "mymd" });

/** The pharmacy_link_status written by the route, if any. */
function linkStatusWrite() {
  return queryMock.mock.calls.find((c) => String(c[0]).includes("pharmacy_link_status"));
}

beforeEach(() => {
  queryMock.mockReset().mockResolvedValue({
    rows: [{ start_time: new Date("2026-08-10T16:00:00Z"), end_time: new Date("2026-08-10T16:15:00Z") }],
    rowCount: 1,
  });
  confirmAppointmentMock.mockReset().mockResolvedValue({
    appointmentId: "appt-1",
    physicianId: "phys-1",
  });
  getClinicBySlugMock.mockReset().mockResolvedValue({
    id: ORG,
    name: "MyMD",
    email: "info@mymdonline.ca",
    settings: {
      onlineBookingEnabled: true,
      healthCardRequired: false,
      timezone: "America/Vancouver",
      emailFooter: null,
      appointmentModality: "PHONE",
    },
  });
  getPhysiciansForBookingMock.mockReset().mockResolvedValue([
    { id: "phys-1", displayName: "Dr. Nahid Mehraein" },
  ]);
  getSlotPhysicianIdMock.mockReset().mockResolvedValue("phys-1");
  physicianSupportsVideoMock.mockReset().mockResolvedValue(true);
  linkOscarPharmacyMock.mockReset().mockResolvedValue({ ok: true });
  upsertOscarPharmacyMock.mockReset();
  isPharmacyUpsertEnabledMock.mockReset().mockReturnValue(false);
  getPharmacyFromDirectoryMock.mockReset().mockResolvedValue(DIRECTORY_ROW);
  findPharmacyByNameCityMock.mockReset().mockResolvedValue(null);
  createOscarAppointmentMock.mockReset().mockResolvedValue({ ok: true, appointmentNo: "555" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST confirm — pharmacy", () => {
  it("does not touch the pharmacy code when no pharmacy was chosen", async () => {
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("manageUrl");

    expect(getPharmacyFromDirectoryMock).not.toHaveBeenCalled();
    expect(linkOscarPharmacyMock).not.toHaveBeenCalled();
    expect(linkStatusWrite()).toBeUndefined();
    expect(confirmAppointmentMock.mock.calls[0]![3].pharmacy).toBeUndefined();
  });

  it("links a directory pick and records LINKED", async () => {
    const res = await POST(
      makeRequest({
        pharmacy: { source: "DIRECTORY", pharmacyId: "1449", name: "Wal-Mart" },
      }),
      { params },
    );
    expect(res.status).toBe(200);

    expect(linkOscarPharmacyMock).toHaveBeenCalledWith(ORG, {
      demographicNo: "46",
      pharmacyId: "1449",
    });
    expect(linkStatusWrite()?.[1]?.[0]).toBe("LINKED");
  });

  it("snapshots the pharmacy from our directory, ignoring client-supplied details", async () => {
    await POST(
      makeRequest({
        pharmacy: {
          source: "DIRECTORY",
          pharmacyId: "1449",
          name: "Attacker Pharmacy",
          fax: "6045550000",
          address: "Nowhere",
        },
      }),
      { params },
    );

    // The stored fax decides where prescriptions go, so it must come from our row, not the client.
    expect(confirmAppointmentMock.mock.calls[0]![3].pharmacy).toEqual({
      oscarPharmacyId: "1449",
      name: "WAL-MART PHARMACY #1213",
      address: "1000 Main St",
      city: "Surrey",
      phone: "6049570711",
      fax: "6049531700",
      source: "DIRECTORY",
    });
  });

  it("still returns a normal confirmation when the bridge is down", async () => {
    linkOscarPharmacyMock.mockRejectedValue(new Error("bridge unreachable"));

    const res = await POST(
      makeRequest({ pharmacy: { source: "DIRECTORY", pharmacyId: "1449", name: "Wal-Mart" } }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("manageUrl");
    expect(linkStatusWrite()?.[1]?.[0]).toBe("FAILED");
  });

  it("records FAILED with the bridge's own message on a structured error", async () => {
    linkOscarPharmacyMock.mockResolvedValue({ error: "demographic not found", status: 404 });

    const res = await POST(
      makeRequest({ pharmacy: { source: "DIRECTORY", pharmacyId: "1449", name: "Wal-Mart" } }),
      { params },
    );

    expect(res.status).toBe(200);
    const write = linkStatusWrite();
    expect(write?.[1]?.[0]).toBe("FAILED");
    expect(String(write?.[1]?.[2])).toContain("demographic not found");
  });

  it("skips free text rather than creating an OSCAR pharmacy row", async () => {
    const res = await POST(
      makeRequest({ pharmacy: { source: "FREE_TEXT", name: "Corner Pharmacy", city: "Burnaby" } }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(upsertOscarPharmacyMock).not.toHaveBeenCalled();
    expect(linkOscarPharmacyMock).not.toHaveBeenCalled();

    const write = linkStatusWrite();
    expect(write?.[1]?.[0]).toBe("SKIPPED");
    expect(String(write?.[1]?.[2])).toContain("staff must link manually");

    // The patient's answer is still stored so staff can act on it.
    expect(confirmAppointmentMock.mock.calls[0]![3].pharmacy).toMatchObject({
      name: "Corner Pharmacy",
      city: "Burnaby",
      source: "FREE_TEXT",
    });
  });

  it("rescues free text that exactly matches a known pharmacy", async () => {
    findPharmacyByNameCityMock.mockResolvedValue(DIRECTORY_ROW);

    await POST(
      makeRequest({
        pharmacy: { source: "FREE_TEXT", name: "WAL-MART PHARMACY #1213", city: "Surrey" },
      }),
      { params },
    );

    expect(confirmAppointmentMock.mock.calls[0]![3].pharmacy.source).toBe("DIRECTORY");
    expect(linkOscarPharmacyMock).toHaveBeenCalledWith(ORG, {
      demographicNo: "46",
      pharmacyId: "1449",
    });
    expect(linkStatusWrite()?.[1]?.[0]).toBe("LINKED");
  });

  it("creates the pharmacy in OSCAR only when upsert is explicitly enabled", async () => {
    isPharmacyUpsertEnabledMock.mockReturnValue(true);
    upsertOscarPharmacyMock.mockResolvedValue({ pharmacyId: "1600" });

    await POST(
      makeRequest({ pharmacy: { source: "FREE_TEXT", name: "Corner Pharmacy", city: "Burnaby" } }),
      { params },
    );

    expect(upsertOscarPharmacyMock).toHaveBeenCalled();
    expect(linkOscarPharmacyMock).toHaveBeenCalledWith(ORG, {
      demographicNo: "46",
      pharmacyId: "1600",
    });
    expect(linkStatusWrite()?.[1]?.[0]).toBe("LINKED");
  });

  it("skips the link when the patient has no OSCAR chart", async () => {
    const res = await POST(
      makeRequest({
        oscarDemographicNo: undefined,
        pharmacy: { source: "DIRECTORY", pharmacyId: "1449", name: "Wal-Mart" },
      }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(linkOscarPharmacyMock).not.toHaveBeenCalled();
    expect(linkStatusWrite()?.[1]?.[0]).toBe("SKIPPED");
  });

  it("degrades an unknown directory id to free text instead of dropping it", async () => {
    getPharmacyFromDirectoryMock.mockResolvedValue(null);

    await POST(
      makeRequest({
        pharmacy: { source: "DIRECTORY", pharmacyId: "999999", name: "Stale Pharmacy" },
      }),
      { params },
    );

    expect(confirmAppointmentMock.mock.calls[0]![3].pharmacy).toMatchObject({
      name: "Stale Pharmacy",
      source: "FREE_TEXT",
    });
    expect(linkOscarPharmacyMock).not.toHaveBeenCalled();
  });

  it("ignores a malformed pharmacy payload without failing the booking", async () => {
    const res = await POST(
      makeRequest({ pharmacy: { source: "DIRECTORY", pharmacyId: "not-a-number", name: "X" } }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(confirmAppointmentMock.mock.calls[0]![3].pharmacy).toBeUndefined();
    expect(linkOscarPharmacyMock).not.toHaveBeenCalled();
  });
});
