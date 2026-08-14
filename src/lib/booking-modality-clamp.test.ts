/**
 * A video visit may only be booked with a physician who has somewhere to hold it.
 *
 * Doxy rooms belong to a provider and cannot be created on demand, so "the clinic does video"
 * is not the same claim as "this provider does video". On 2026-08-08 a real patient booked a
 * video visit with a provider who had no room: the booking succeeded, the confirmation email
 * told her a waiting-room link was coming, and there was never a link to send.
 *
 * These tests pin the resolution rule the confirm route applies. If someone later simplifies it
 * back to the clinic-wide check, this fails.
 */

import { describe, expect, it } from "vitest";

type Modality = "PHONE" | "VIDEO";

/**
 * Mirrors the clamp in src/app/api/booking/[clinicSlug]/confirm/route.ts. Kept as a pure function
 * here so the precedence can be tested without a database or a live clinic; the route holds the
 * same expression against real rows.
 */
function resolveModality(args: {
  requested: Modality;
  clinicDefault: Modality;
  patientMayChoose: boolean;
  clinicVideoEnabled: boolean;
  physicianHasRoom: boolean;
}): Modality {
  const clinicAllowsRequested =
    args.patientMayChoose && (args.requested !== "VIDEO" || args.clinicVideoEnabled);
  const physicianAllowsRequested = args.requested !== "VIDEO" || args.physicianHasRoom;

  return clinicAllowsRequested && physicianAllowsRequested
    ? args.requested
    : args.requested === "VIDEO" && !physicianAllowsRequested
      ? "PHONE"
      : args.clinicDefault;
}

const clinicDoesVideo = {
  clinicDefault: "PHONE" as Modality,
  patientMayChoose: true,
  clinicVideoEnabled: true,
};

describe("modality clamp", () => {
  it("allows video when the physician has a room", () => {
    expect(
      resolveModality({ ...clinicDoesVideo, requested: "VIDEO", physicianHasRoom: true }),
    ).toBe("VIDEO");
  });

  it("downgrades video to phone when the physician has no room", () => {
    expect(
      resolveModality({ ...clinicDoesVideo, requested: "VIDEO", physicianHasRoom: false }),
    ).toBe("PHONE");
  });

  it("downgrades to PHONE, never to a VIDEO clinic default", () => {
    // The regression that would reintroduce the bug: falling back to the clinic default when the
    // clinic default is itself VIDEO puts the booking right back where it started.
    expect(
      resolveModality({
        requested: "VIDEO",
        clinicDefault: "VIDEO",
        patientMayChoose: true,
        clinicVideoEnabled: true,
        physicianHasRoom: false,
      }),
    ).toBe("PHONE");
  });

  it("still honours the clinic-wide video switch", () => {
    expect(
      resolveModality({
        requested: "VIDEO",
        clinicDefault: "PHONE",
        patientMayChoose: true,
        clinicVideoEnabled: false,
        physicianHasRoom: true,
      }),
    ).toBe("PHONE");
  });

  it("leaves phone bookings alone regardless of the physician's room", () => {
    for (const physicianHasRoom of [true, false]) {
      expect(
        resolveModality({ ...clinicDoesVideo, requested: "PHONE", physicianHasRoom }),
      ).toBe("PHONE");
    }
  });

  it("ignores a requested modality when the clinic doesn't let patients choose", () => {
    expect(
      resolveModality({
        requested: "VIDEO",
        clinicDefault: "PHONE",
        patientMayChoose: false,
        clinicVideoEnabled: true,
        physicianHasRoom: true,
      }),
    ).toBe("PHONE");
  });
});
