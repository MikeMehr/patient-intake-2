"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MODALITY_ICON, normalizeModality } from "@/lib/appointment-modality";
import { localDateString } from "@/lib/localDate";

type Appointment = {
  id: string;
  physicianFirstName: string;
  physicianLastName: string;
  slotStartTime: string;
  firstName: string;
  lastName: string;
  email: string;
  coverageType: string;
  province: string | null;
  billingNote: string | null;
  reason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  oscarSyncStatus: string | null;
  /** null means "inherit the clinic default" — see resolveEffectiveModality. */
  appointmentModality: string | null;
  /** The provider's permanent Doxy waiting room, or null when they haven't set one. */
  doxyRoomUrl: string | null;
  /** null means the question wasn't asked (booked before it existed). */
  aiScribeConsent: boolean | null;
  /** Photos/PDFs the patient attached while booking. */
  attachments?: { id: string; filename: string | null; contentType: string | null }[];
};

type Physician = { id: string; firstName: string; lastName: string };

const COVERAGE_LABELS: Record<string, string> = {
  CANADIAN_HEALTH_CARD: "Health card",
  PRIVATE_PAY: "Private pay",
  TRAVEL_INSURANCE: "Travel ins.",
  UNINSURED: "Uninsured",
};

function formatDT(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * How the appointment happens, as a word rather than a shade of button.
 *
 * The Video column already differed for video bookings — solid button versus muted — but a
 * colour difference is not something anyone can read down a column of appointments, and staff
 * need to know whether to pick up the phone or wait in a room. So it is spelled out.
 *
 * Never blank: the API resolves a NULL modality against the clinic default before sending.
 */
function ModalityTag({ modality }: { modality: string | null }) {
  const m = normalizeModality(modality);
  const tone =
    m === "VIDEO"
      ? "text-blue-700"
      : m === "IN_PERSON"
        ? "text-purple-700"
        : "text-gray-500";
  const label = m === "VIDEO" ? "Video" : m === "IN_PERSON" ? "In person" : "Phone";
  return (
    <p className={`text-xs font-medium ${tone}`}>
      <span aria-hidden>{MODALITY_ICON[m]}</span> {label}
    </p>
  );
}

/**
 * Launch the video console for an appointment.
 *
 * Offered on every appointment, not only the ones booked as video — the same reasoning as the
 * OSCAR day-sheet button. A patient who booked a phone visit and then can't be reached, or who
 * turns out to need to be looked at, is exactly when a clinician wants to start a video call,
 * and making them rebook to do it would be absurd. Appointments actually booked as video get the
 * solid button so they stand out in a day of phone calls.
 *
 * Goes to the PROVIDER's Doxy dashboard, not the patient's check-in page. Doxy has two addresses
 * and only one of them is any use to a clinician: the patient link opens a "please check in"
 * form. The patient link lives on the invite page, where it is being sent to a patient.
 *
 * Opens in a new tab so the list stays put behind the call.
 */
const DOXY_DASHBOARD_URL = "https://doxy.me/sign-in";

function VideoCell({
  doxyRoomUrl,
  modality,
  cancelled,
}: {
  doxyRoomUrl: string | null;
  modality: string | null;
  cancelled: boolean;
}) {
  // Nothing to start, and a live join link for a cancelled appointment is precisely what
  // cancelVisitsForAppointment exists to prevent.
  if (cancelled) return <span className="text-gray-300">—</span>;
  // No room configured yet — say so rather than offering a link to nowhere.
  if (!doxyRoomUrl) {
    return (
      <span className="text-xs text-gray-300" title="No Doxy room set for this provider">
        —
      </span>
    );
  }

  const isVideo = modality === "VIDEO";
  return (
    <a
      href={DOXY_DASHBOARD_URL}
      target="_blank"
      rel="noopener noreferrer"
      title={
        isVideo
          ? "Open your Doxy dashboard to see this patient check in"
          : "Open your Doxy dashboard (this was booked as a phone or in-person visit)"
      }
      className={
        isVideo
          ? "inline-block whitespace-nowrap rounded-full bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700"
          : "inline-block whitespace-nowrap rounded-full border border-gray-200 px-2 py-0.5 text-xs font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700"
      }
    >
      🎥 Open
    </a>
  );
}

function OscarBadge({ status }: { status: string | null }) {
  if (status === "SYNCED") {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
        In OSCAR
      </span>
    );
  }
  if (status === "FAILED") {
    return (
      <span
        className="inline-block px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-xs font-medium"
        title="The appointment could not be written to OSCAR. Enter it manually or retry."
      >
        Not in OSCAR
      </span>
    );
  }
  if (status === "CANCELLED") {
    return (
      <span
        className="inline-block px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-xs font-medium"
        title="This appointment was marked Cancelled in OSCAR."
      >
        Cancelled in OSCAR
      </span>
    );
  }
  if (status === "SKIPPED") {
    return (
      <span
        className="inline-block px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium"
        title="OSCAR sync was skipped (no provider number / patient record / connection). Enter manually if needed."
      >
        Not synced
      </span>
    );
  }
  return <span className="text-gray-300 text-xs">—</span>;
}

export default function AppointmentsPage() {
  const router = useRouter();
  const [physicians, setPhysicians] = useState<Physician[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [filterPhysicianId, setFilterPhysicianId] = useState("all");
  const [dateFrom, setDateFrom] = useState(localDateString());
  const [dateTo, setDateTo] = useState(localDateString(30));
  const [bookedOnly, setBookedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const visibleAppointments = bookedOnly
    ? appointments.filter((a) => !a.cancelledAt)
    : appointments;

  useEffect(() => {
    fetch("/api/org/providers")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => {
        setPhysicians(
          (data.providers ?? []).map((p: Record<string, string>) => ({
            id: p.id,
            firstName: p.firstName,
            lastName: p.lastName,
          })),
        );
      })
      .catch(() => router.push("/org/login"));
  }, [router]);

  function loadAppointments() {
    const qs = new URLSearchParams({ dateFrom, dateTo });
    if (filterPhysicianId !== "all") qs.set("physicianId", filterPhysicianId);
    setLoading(true);
    fetch(`/api/org/appointments?${qs}`)
      .then((r) => r.json())
      .then((data) => {
        setAppointments(data.appointments ?? []);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load appointments.");
        setLoading(false);
      });
  }

  useEffect(() => {
    loadAppointments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, filterPhysicianId]);

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-5xl mx-auto">
        <button onClick={() => router.push("/org/dashboard")} className="text-blue-600 text-sm mb-4">
          ← Dashboard
        </button>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Appointments</h1>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <select
            value={filterPhysicianId}
            onChange={(e) => setFilterPhysicianId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All physicians</option>
            {physicians.map((p) => (
              <option key={p.id} value={p.id}>
                Dr. {p.firstName} {p.lastName}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2 text-sm">
            <label className="text-gray-600">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label className="text-gray-600">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={() => setBookedOnly((v) => !v)}
            className={
              bookedOnly
                ? "rounded-lg border border-green-600 bg-green-600 px-3 py-2 text-sm font-medium text-white"
                : "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:border-gray-400"
            }
            title="Hide cancelled appointments"
          >
            Booked only
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm mb-4">
            {error}
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {loading ? (
            <p className="text-gray-400 text-sm p-6 text-center">Loading…</p>
          ) : visibleAppointments.length === 0 ? (
            <p className="text-gray-400 text-sm p-6 text-center">
              {bookedOnly && appointments.length > 0
                ? "No booked appointments in this date range (only cancelled ones)."
                : "No appointments in this date range."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              {/* text-xs rather than text-sm: nine columns of clinical data need the room more
                  than the type needs the size, and this table is scanned, not read. */}
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-2 py-2 text-gray-600 font-medium">Date &amp; time</th>
                    <th className="text-left px-2 py-2 text-gray-600 font-medium">Patient</th>
                    <th className="text-left px-2 py-2 text-gray-600 font-medium">Physician</th>
                    <th className="text-left px-2 py-2 text-gray-600 font-medium">Reason</th>
                    <th className="text-left px-2 py-2 text-gray-600 font-medium">Coverage</th>
                    <th className="text-left px-2 py-2 text-gray-600 font-medium">Status</th>
                    <th className="text-left px-2 py-2 text-gray-600 font-medium">OSCAR</th>
                    <th className="text-left px-2 py-2 text-gray-600 font-medium">Scribe</th>
                    <th className="text-left px-2 py-2 text-gray-600 font-medium">Video</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleAppointments.map((appt) => (
                    <tr key={appt.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="px-2 py-2 text-gray-800 whitespace-nowrap">
                        {formatDT(appt.slotStartTime)}
                        {/* Under the date rather than in its own column: the format is something
                            you read together with the time ("10:00, and it's a phone call"), and
                            the row is already eight columns wide. The API resolves the clinic
                            default, so this is never blank. */}
                        <ModalityTag modality={appt.appointmentModality} />
                      </td>
                      <td className="px-2 py-2">
                        <p className="font-medium text-gray-900 whitespace-nowrap">
                          {appt.firstName} {appt.lastName}
                        </p>
                        <p className="text-gray-400 text-xs break-all">{appt.email}</p>
                      </td>
                      <td className="px-2 py-2 text-gray-700 whitespace-nowrap">
                        {/* "Dr." is redundant in a clinic's own list and cost real width. */}
                        {appt.physicianLastName}
                      </td>
                      <td className="px-2 py-2 text-gray-700 min-w-[8rem]">
                        {appt.reason ?? <span className="text-gray-300">—</span>}
                        {appt.attachments?.map((f) => (
                          <a
                            key={f.id}
                            href={`/api/org/appointments/files/${f.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-blue-600 hover:underline break-all mt-1"
                          >
                            📎 {f.filename ?? "Attachment"}
                          </a>
                        ))}
                      </td>
                      <td className="px-2 py-2 text-gray-600">
                        {COVERAGE_LABELS[appt.coverageType] ?? appt.coverageType}
                        {appt.province && (
                          <span className="text-gray-400 text-xs block">{appt.province}</span>
                        )}
                        {appt.billingNote && (
                          <span className="text-gray-400 text-xs block">{appt.billingNote}</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {appt.cancelledAt ? (
                          <span className="inline-block px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-xs font-medium">
                            Cancelled
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                            Booked
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <OscarBadge status={appt.oscarSyncStatus} />
                      </td>
                      {/* Three distinct states: a decline must read as a deliberate "do not use
                          the scribe", never as missing data. */}
                      <td className="px-2 py-2">
                        {appt.aiScribeConsent === true ? (
                          <span className="text-green-600" title="Patient consented to AI scribe use">✓</span>
                        ) : appt.aiScribeConsent === false ? (
                          <span className="text-red-600 font-semibold" title="Patient DECLINED AI scribe use">✗</span>
                        ) : (
                          <span className="text-gray-300" title="Not asked (booked before this question existed)">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <VideoCell
                          doxyRoomUrl={appt.doxyRoomUrl}
                          modality={appt.appointmentModality}
                          cancelled={!!appt.cancelledAt}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
