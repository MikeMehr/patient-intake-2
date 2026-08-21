/**
 * The physician's booking alert is the only thing about a booking most physicians ever read, so
 * these tests pin what it is allowed to say — in particular for a returning patient, whose phone
 * number and health card live on the OSCAR chart rather than in anything they typed.
 *
 * The chart read is best-effort by design: it happens after the booking is committed, so every
 * way it can fail has to leave the text no worse than it was.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const confirmAppointmentMock = vi.hoisted(() => vi.fn());
const getClinicBySlugMock = vi.hoisted(() => vi.fn());
const getPhysiciansForBookingMock = vi.hoisted(() => vi.fn());
const getSlotPhysicianIdMock = vi.hoisted(() => vi.fn());
const physicianSupportsVideoMock = vi.hoisted(() => vi.fn());
const sendBookingAlertSMSMock = vi.hoisted(() => vi.fn());
const getPhysicianPhoneMock = vi.hoisted(() => vi.fn());
const getOscarCredsForOrgMock = vi.hoisted(() => vi.fn());
const fetchOscarDemographicMock = vi.hoisted(() => vi.fn());

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

// Partial mock: only the send is stubbed. toE164 is the real one, because whether the chart's
// phone number survives normalization is exactly what is under test.
vi.mock("@/lib/sms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sms")>()),
  sendBookingAlertSMS: (...a: unknown[]) => sendBookingAlertSMSMock(...a),
}));

vi.mock("@/lib/physician-lookup", () => ({
  getPhysicianPhone: (...a: unknown[]) => getPhysicianPhoneMock(...a),
}));

vi.mock("@/lib/oscar/self-serve", () => ({
  getOscarCredsForOrg: (...a: unknown[]) => getOscarCredsForOrgMock(...a),
}));

vi.mock("@/lib/oscar/demographics", () => ({
  fetchOscarDemographic: (...a: unknown[]) => fetchOscarDemographicMock(...a),
}));

vi.mock("@/lib/encrypted-field", () => ({
  encryptString: (v: string) => `enc:${v}`,
  decryptString: (v: string) => v,
}));

vi.mock("@/lib/oscar/appointments", () => ({
  createOscarAppointment: vi.fn(async () => ({ ok: true, appointmentNo: "555" })),
  toClinicLocalParts: () => ({ date: "2026-08-10", time: "09:00" }),
}));

vi.mock("@/lib/oscar/pharmacy", () => ({
  linkOscarPharmacy: vi.fn(async () => ({ ok: true })),
  upsertOscarPharmacy: vi.fn(),
  isPharmacyUpsertEnabled: () => false,
}));

vi.mock("@/lib/pharmacy-directory", () => ({
  getPharmacyFromDirectory: vi.fn(async () => null),
  findPharmacyByNameCity: vi.fn(async () => null),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

const ORG = "11111111-1111-1111-1111-111111111111";
// Passes the BC PHN check digit (mod 11 over digits 2..9). Synthetic.
const VALID_BC_PHN = "9999999998";

const CREDS = {
  client_key: "key",
  clientSecret: "secret",
  accessToken: "token",
  tokenSecret: "token-secret",
  restBase: "https://oscar.test/oscar/ws/rs",
};

/** A chart as fetchOscarDemographic normalizes it, with only the fields the alert reads set. */
function chart(overrides: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    demographic: {
      demographicNo: "46",
      firstName: "Ali",
      lastName: "Test",
      dateOfBirth: "1988-04-15",
      patientEmail: null,
      primaryPhone: "604 555 0134",
      secondaryPhone: null,
      insuranceNumber: VALID_BC_PHN,
      healthCardType: "BC",
      patientAddress: null,
      ...overrides,
    },
  };
}

function makeRequest(extra: Record<string, unknown> = {}): NextRequest {
  const req = new NextRequest("https://booking.test/api/booking/mymd/confirm", {
    method: "POST",
    body: JSON.stringify({
      slotId: "slot-1",
      firstName: "Ali",
      lastName: "Test",
      dateOfBirth: "1988-04-15",
      email: "ali@example.com",
      reason: "Ear infection",
      coverageType: "EXISTING_OSCAR_PATIENT",
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

/** The details object the route handed to sendBookingAlertSMS. */
function alert() {
  return sendBookingAlertSMSMock.mock.calls[0]?.[1];
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
    name: "MyMD Telehealth",
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
  sendBookingAlertSMSMock.mockReset().mockResolvedValue({ success: true });
  getPhysicianPhoneMock.mockReset().mockResolvedValue("+16045550100");
  getOscarCredsForOrgMock.mockReset().mockResolvedValue(CREDS);
  fetchOscarDemographicMock.mockReset().mockResolvedValue(chart());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST confirm — physician booking alert", () => {
  it("reads a returning patient's phone and card off the chart", async () => {
    // The returning-patient form used to collect neither, which is why the alert for these
    // bookings carried no number at all and said "MSP: see chart".
    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(200);
    expect(fetchOscarDemographicMock).toHaveBeenCalledWith(CREDS, "46");
    expect(alert().patientPhone).toBe("+16045550134");
    expect(alert().mspStatus).toBe("eligible (chart)");
  });

  it("prefers the number the patient just typed over the one on the chart", async () => {
    const res = await POST(makeRequest({ phone: "(778) 555-0199" }), { params });

    expect(res.status).toBe(200);
    expect(alert().patientPhone).toBe("+17785550199");
  });

  it("says the chart has no card rather than implying one was checked", async () => {
    fetchOscarDemographicMock.mockResolvedValue(chart({ insuranceNumber: null }));

    await POST(makeRequest(), { params });

    expect(alert().mspStatus).toBe("No health card number on the chart");
  });

  it("falls back to see chart when OSCAR cannot be reached", async () => {
    fetchOscarDemographicMock.mockResolvedValue({
      ok: false,
      reason: "oscar_error",
      status: 503,
      detail: "connect ETIMEDOUT",
    });

    const res = await POST(makeRequest(), { params });

    // The booking is already committed by this point and must survive intact.
    expect(res.status).toBe(200);
    expect(alert().mspStatus).toBe("see chart");
    expect(alert().patientPhone).toBeUndefined();
  });

  it("falls back to see chart when the clinic has no OSCAR connection", async () => {
    getOscarCredsForOrgMock.mockResolvedValue(null);

    await POST(makeRequest(), { params });

    expect(fetchOscarDemographicMock).not.toHaveBeenCalled();
    expect(alert().mspStatus).toBe("see chart");
  });

  it("still sends the alert when the chart read throws outright", async () => {
    fetchOscarDemographicMock.mockRejectedValue(new Error("boom"));

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(200);
    expect(sendBookingAlertSMSMock).toHaveBeenCalled();
    expect(alert().mspStatus).toBe("see chart");
  });

  it("does not read the chart for a patient who gave their own card", async () => {
    // A new patient types their card into the form, so there is nothing to look up — and no
    // reason to spend an OSCAR round-trip on the booking path.
    await POST(
      makeRequest({
        coverageType: "CANADIAN_HEALTH_CARD",
        province: "British Columbia",
        healthCardNumber: VALID_BC_PHN,
        phone: "604-555-0177",
      }),
      { params },
    );

    expect(fetchOscarDemographicMock).not.toHaveBeenCalled();
    expect(alert().mspStatus).toBe("eligible");
    expect(alert().patientPhone).toBe("+16045550177");
  });

  it("never puts the health card number in the message", async () => {
    await POST(makeRequest(), { params });

    expect(JSON.stringify(alert())).not.toContain(VALID_BC_PHN);
  });
});
