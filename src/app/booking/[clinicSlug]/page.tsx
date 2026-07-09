"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";

type Physician = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
};

type Slot = {
  id: string;
  physicianId: string;
  physicianName: string;
  startTime: string;
  endTime: string;
  status: "OPEN" | "BLOCKED" | "HELD" | "BOOKED";
};

type ClinicSettings = {
  showBlockedSlots: boolean;
  timezone: string;
  slotIntervalMinutes: number;
  cancellationPolicy: string | null;
  bookingInstructions: string | null;
  healthCardRequired: boolean;
};

type ClinicInfo = {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
};

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toLocalDateString(isoString: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(isoString));
}

function toLocalTimeString(isoString: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(isoString));
}

function groupByDate(slots: Slot[], tz: string): Record<string, Slot[]> {
  const groups: Record<string, Slot[]> = {};
  for (const slot of slots) {
    const key = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(slot.startTime));
    if (!groups[key]) groups[key] = [];
    groups[key].push(slot);
  }
  return groups;
}

export default function ClinicBookingPage({
  params,
}: {
  params: Promise<{ clinicSlug: string }>;
}) {
  const { clinicSlug } = use(params);
  const router = useRouter();

  const [clinic, setClinic] = useState<ClinicInfo | null>(null);
  const [settings, setSettings] = useState<ClinicSettings | null>(null);
  const [physicians, setPhysicians] = useState<Physician[]>([]);
  const [selectedPhysicianId, setSelectedPhysicianId] = useState<string>("any");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [bookingClosed, setBookingClosed] = useState(false);
  const [bookingClosedMsg, setBookingClosedMsg] = useState("");
  const [holdingSlotId, setHoldingSlotId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const today = new Date();
  const dateFrom = today.toISOString().substring(0, 10);
  const dateTo = addDays(today, 13).toISOString().substring(0, 10);

  // Load clinic info
  useEffect(() => {
    fetch(`/api/booking/${clinicSlug}/info`)
      .then((r) => {
        if (!r.ok) throw new Error("Clinic not found");
        return r.json();
      })
      .then((data) => {
        setClinic(data.clinic);
        setSettings(data.settings);
        setPhysicians(data.physicians ?? []);
        setLoadingInfo(false);
      })
      .catch(() => {
        setError("This clinic does not have online booking enabled.");
        setLoadingInfo(false);
      });
  }, [clinicSlug]);

  // Load slots whenever physician selection or clinic changes
  useEffect(() => {
    if (!clinic) return;
    setLoadingSlots(true);
    setBookingClosed(false);

    const qs = new URLSearchParams({ dateFrom, dateTo });
    if (selectedPhysicianId !== "any") qs.set("physicianId", selectedPhysicianId);

    fetch(`/api/booking/${clinicSlug}/slots?${qs}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.bookingClosed) {
          setBookingClosed(true);
          setBookingClosedMsg(data.message ?? "Online booking is currently closed.");
          setSlots([]);
        } else {
          setSlots(data.slots ?? []);
        }
        setLoadingSlots(false);
      })
      .catch(() => {
        setError("Unable to load available times.");
        setLoadingSlots(false);
      });
  }, [clinic, clinicSlug, selectedPhysicianId, dateFrom, dateTo]);

  async function handleSelectSlot(slot: Slot) {
    if (slot.status !== "OPEN") return;
    setHoldingSlotId(slot.id);
    setError(null);

    try {
      const res = await fetch(`/api/booking/${clinicSlug}/hold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId: slot.id }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Unable to hold this slot. Please try again.");
        setHoldingSlotId(null);
        return;
      }

      router.push(`/booking/${clinicSlug}/confirm?slotId=${slot.id}&startTime=${encodeURIComponent(slot.startTime)}&physician=${encodeURIComponent(slot.physicianName)}`);
    } catch {
      setError("Something went wrong. Please try again.");
      setHoldingSlotId(null);
    }
  }

  if (loadingInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  if (error && !clinic) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button onClick={() => router.push("/booking")} className="text-blue-600 underline">
            Back to clinic list
          </button>
        </div>
      </div>
    );
  }

  const tz = settings?.timezone ?? "America/Vancouver";
  const grouped = groupByDate(slots.filter((s) => s.status === "OPEN" || (settings?.showBlockedSlots && s.status === "BLOCKED")), tz);
  const dates = Object.keys(grouped).sort();

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{clinic?.name}</h1>
          {clinic?.address && <p className="text-gray-500 text-sm mt-1">{clinic.address}</p>}
          {settings?.bookingInstructions && (
            <p className="text-gray-600 text-sm mt-2 bg-blue-50 border border-blue-100 rounded-lg p-3">
              {settings.bookingInstructions}
            </p>
          )}
        </div>

        {/* Physician selector */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select physician
          </label>
          <select
            value={selectedPhysicianId}
            onChange={(e) => setSelectedPhysicianId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="any">Any available doctor</option>
            {physicians.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </div>

        {/* Booking window closed */}
        {bookingClosed && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 text-sm">
            {bookingClosedMsg}
          </div>
        )}

        {/* Error */}
        {error && clinic && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm mb-4">
            {error}
          </div>
        )}

        {/* Slots */}
        {loadingSlots ? (
          <p className="text-gray-400 text-sm text-center py-10">Loading available times…</p>
        ) : !bookingClosed && dates.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-500">
            No available appointment times in the next two weeks.
          </div>
        ) : (
          <div className="space-y-6">
            {dates.map((date) => (
              <div key={date} className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="font-semibold text-gray-800 mb-3">
                  {new Intl.DateTimeFormat("en-CA", {
                    timeZone: tz,
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  }).format(new Date(grouped[date][0].startTime))}
                </p>
                <div className="flex flex-wrap gap-2">
                  {grouped[date].map((slot) => {
                    const isOpen = slot.status === "OPEN";
                    const isHolding = holdingSlotId === slot.id;
                    return (
                      <button
                        key={slot.id}
                        disabled={!isOpen || holdingSlotId !== null}
                        onClick={() => handleSelectSlot(slot)}
                        title={isOpen ? `${slot.physicianName}` : slot.status}
                        className={[
                          "px-3 py-2 rounded-lg text-sm font-medium border transition",
                          isOpen && !holdingSlotId
                            ? "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                            : isHolding
                            ? "bg-blue-600 border-blue-600 text-white"
                            : "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed",
                        ].join(" ")}
                      >
                        {isHolding ? "…" : toLocalTimeString(slot.startTime, tz)}
                        {selectedPhysicianId === "any" && isOpen && (
                          <span className="block text-xs text-blue-500">{slot.physicianName.replace("Dr. ", "Dr.")}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Cancellation policy */}
        {settings?.cancellationPolicy && (
          <p className="text-xs text-gray-400 mt-6 border-t pt-4">{settings.cancellationPolicy}</p>
        )}
      </div>
    </main>
  );
}
