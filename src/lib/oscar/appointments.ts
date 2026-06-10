/**
 * Create an appointment in OSCAR EMR's schedule.
 *
 * Hits OSCAR's ScheduleService REST endpoint:
 *   POST {base}/ws/services/schedule/add   (Consumes application/json)
 * with a NewAppointmentTo1 body. Contract taken from OSCAR source
 * (org.oscarehr.ws.rest.ScheduleService#addAppointment +
 *  org.oscarehr.ws.rest.conversion.NewAppointmentConverter):
 *   - providerNo       String   OSCAR provider number
 *   - demographicNo    int      OSCAR patient (demographic) number
 *   - appointmentDate  String   "yyyy-MM-dd"
 *   - startTime        String   "HH:mm" (24h) — converter parses "yyyy-MM-dd HH:mm"
 *   - duration         int      minutes; OSCAR sets endTime = start + (duration - 1)
 *   - status/type/reason/notes/name  optional Strings
 *
 * Auth + transport mirror create-oscar-patient: OAuth1-signed, JSON body via the
 * SSL-tolerant oscarFetch, Authorization header first with query-param fallback on 401.
 */

import { getOscarRestBase, oscarFetch } from "./client";
import { signOAuth1Request } from "./oauth1";

export type OscarCreds = {
  clientKey: string;
  clientSecret: string;
  accessToken: string;
  tokenSecret: string;
};

export type CreateOscarAppointmentArgs = {
  oscarBaseUrl: string;
  creds: OscarCreds;
  providerNo: string;
  demographicNo: number;
  appointmentDate: string; // "yyyy-MM-dd" (clinic-local)
  startTime: string; // "HH:mm" (clinic-local, 24h)
  durationMinutes: number;
  name?: string; // day-sheet label; OSCAR overrides with demographic name
  reason?: string;
  notes?: string;
  status?: string; // OSCAR appointment status code; default "t" (booked/To do)
  type?: string;
};

export type CreateOscarAppointmentResult =
  | { ok: true; appointmentNo: string | null }
  | { ok: false; status: number; detail: string };

/**
 * Convert a TIMESTAMPTZ instant to clinic-local "yyyy-MM-dd" date and "HH:mm" time.
 * Uses Intl so the wall-clock matches the clinic timezone OSCAR expects.
 */
export function toClinicLocalParts(
  instant: Date,
  timeZone: string,
): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  let hour = get("hour");
  if (hour === "24") hour = "00"; // some engines emit 24 for midnight
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
  };
}

function extractAppointmentNo(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  // SchedulingResponse wraps the created appointment under `appointment`.
  const appt = (obj.appointment ?? obj.content ?? obj) as Record<string, unknown>;
  const no = String(
    appt?.appointmentNo ?? appt?.id ?? appt?.appointment_no ?? "",
  ).trim();
  return no || null;
}

export async function createOscarAppointment(
  args: CreateOscarAppointmentArgs,
): Promise<CreateOscarAppointmentResult> {
  const url = `${getOscarRestBase(args.oscarBaseUrl)}/schedule/add`;

  const payload: Record<string, unknown> = {
    providerNo: args.providerNo,
    demographicNo: args.demographicNo, // JSON number — OSCAR field is int
    appointmentDate: args.appointmentDate,
    startTime: args.startTime,
    duration: Math.max(1, Math.round(args.durationMinutes)),
    status: args.status ?? "t",
    type: args.type ?? "",
    reason: args.reason ?? "",
    notes: args.notes ?? "",
  };
  if (args.name) payload.name = args.name;

  const bodyStr = JSON.stringify(payload);

  const signed = signOAuth1Request({
    method: "POST",
    url,
    consumerKey: args.creds.clientKey,
    consumerSecret: args.creds.clientSecret,
    token: args.creds.accessToken,
    tokenSecret: args.creds.tokenSecret,
  });

  const doFetch = async (useHeader: boolean) => {
    const fetchUrl = useHeader
      ? signed.signedUrl
      : (() => {
          const u = new URL(signed.signedUrl);
          for (const [k, v] of Object.entries(signed.oauthParams)) u.searchParams.set(k, v);
          return u.toString();
        })();
    try {
      return await oscarFetch(fetchUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(useHeader ? { Authorization: signed.authorizationHeader } : {}),
        },
        body: bodyStr,
      });
    } catch {
      return null; // network/DNS error
    }
  };

  const res1 = await doFetch(true);
  if (!res1) return { ok: false, status: 503, detail: "Network error reaching Oscar" };
  let res = res1;
  if (!res.ok && res.status === 401) {
    const res2 = await doFetch(false);
    if (!res2) return { ok: false, status: 503, detail: "Network error reaching Oscar" };
    res = res2;
  }

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, detail: text.slice(0, 500) };
  }
  try {
    return { ok: true, appointmentNo: extractAppointmentNo(JSON.parse(text)) };
  } catch {
    // OSCAR returned 2xx but non-JSON — treat as created, id unknown.
    return { ok: true, appointmentNo: null };
  }
}
