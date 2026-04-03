"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
  cancelledAt: string | null;
  createdAt: string;
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

export default function AppointmentsPage() {
  const router = useRouter();
  const [physicians, setPhysicians] = useState<Physician[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [filterPhysicianId, setFilterPhysicianId] = useState("all");
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().substring(0, 10));
  const [dateTo, setDateTo] = useState(
    new Date(Date.now() + 30 * 86400000).toISOString().substring(0, 10),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm mb-4">
            {error}
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {loading ? (
            <p className="text-gray-400 text-sm p-6 text-center">Loading…</p>
          ) : appointments.length === 0 ? (
            <p className="text-gray-400 text-sm p-6 text-center">No appointments in this date range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Date & time</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Patient</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Physician</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Coverage</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((appt) => (
                    <tr key={appt.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-800 whitespace-nowrap">
                        {formatDT(appt.slotStartTime)}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">
                          {appt.firstName} {appt.lastName}
                        </p>
                        <p className="text-gray-400 text-xs">{appt.email}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        Dr. {appt.physicianFirstName} {appt.physicianLastName}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {COVERAGE_LABELS[appt.coverageType] ?? appt.coverageType}
                        {appt.province && (
                          <span className="text-gray-400 text-xs block">{appt.province}</span>
                        )}
                        {appt.billingNote && (
                          <span className="text-gray-400 text-xs block">{appt.billingNote}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
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
