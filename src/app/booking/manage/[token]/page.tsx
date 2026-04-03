"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Appointment = {
  id: string;
  physicianFirstName: string;
  physicianLastName: string;
  slotStartTime: string;
  slotEndTime: string;
  firstName: string;
  lastName: string;
  email: string;
  coverageType: string;
  cancelledAt: string | null;
};

export default function ManageAppointmentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();

  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    fetch(`/api/booking/manage/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then((data) => {
        setAppointment(data.appointment);
        setLoading(false);
      })
      .catch(() => {
        setError("Appointment not found or link has expired.");
        setLoading(false);
      });
  }, [token]);

  async function handleCancel() {
    if (!confirm("Are you sure you want to cancel this appointment?")) return;
    setCancelling(true);

    const res = await fetch(`/api/booking/manage/${token}/cancel`, { method: "POST" });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Unable to cancel. Please try again.");
      setCancelling(false);
      return;
    }

    setCancelled(true);
    setCancelling(false);
  }

  function formatDateTime(iso: string): string {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  if (error || !appointment) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error ?? "Appointment not found."}</p>
          <button onClick={() => router.push("/booking")} className="text-blue-600 underline">
            Book a new appointment
          </button>
        </div>
      </div>
    );
  }

  const isCancelled = !!appointment.cancelledAt || cancelled;

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        {isCancelled ? (
          <>
            <div className="text-gray-400 text-5xl mb-4 text-center">✕</div>
            <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">Appointment Cancelled</h2>
            <p className="text-gray-500 text-center text-sm mb-6">
              Your appointment has been cancelled. The time slot has been released.
            </p>
            <div className="text-center">
              <button
                onClick={() => router.push("/booking")}
                className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
              >
                Book a new appointment
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-gray-900 mb-1">Your Appointment</h2>
            <p className="text-gray-500 text-sm mb-6">Manage or cancel your booking below.</p>

            <div className="space-y-3 mb-8">
              <Row label="Patient" value={`${appointment.firstName} ${appointment.lastName}`} />
              <Row label="Physician" value={`Dr. ${appointment.physicianFirstName} ${appointment.physicianLastName}`} />
              <Row label="Date & time" value={formatDateTime(appointment.slotStartTime)} />
              <Row label="Coverage" value={appointment.coverageType.replace(/_/g, " ")} />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm mb-4">
                {error}
              </div>
            )}

            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="w-full bg-red-50 border border-red-200 text-red-700 py-3 rounded-lg font-semibold hover:bg-red-100 disabled:opacity-50 transition"
            >
              {cancelling ? "Cancelling…" : "Cancel Appointment"}
            </button>
          </>
        )}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="text-gray-500 text-sm w-28 shrink-0">{label}</span>
      <span className="text-gray-900 text-sm font-medium">{value}</span>
    </div>
  );
}
