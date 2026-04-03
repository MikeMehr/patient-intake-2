"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const TIMEZONES = [
  "America/Vancouver",
  "America/Edmonton",
  "America/Winnipeg",
  "America/Toronto",
  "America/Halifax",
  "America/St_Johns",
];

const SLOT_INTERVALS = [10, 15, 20, 30, 45, 60];

type Physician = {
  id: string;
  firstName: string;
  lastName: string;
  onlineBookingEnabled: boolean;
};

type Settings = {
  onlineBookingEnabled: boolean;
  publicBookingStart: string;
  publicBookingEnd: string;
  enforceBookingWindow: boolean;
  slotIntervalMinutes: number;
  healthCardRequired: boolean;
  showBlockedSlots: boolean;
  cancellationPolicy: string | null;
  bookingInstructions: string | null;
  timezone: string;
};

export default function BookingSettingsPage() {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [physicians, setPhysicians] = useState<Physician[]>([]);
  const [settings, setSettings] = useState<Settings>({
    onlineBookingEnabled: false,
    publicBookingStart: "07:00",
    publicBookingEnd: "22:00",
    enforceBookingWindow: true,
    slotIntervalMinutes: 15,
    healthCardRequired: false,
    showBlockedSlots: false,
    cancellationPolicy: "",
    bookingInstructions: "",
    timezone: "America/Vancouver",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/org/booking-settings").then((r) => r.json()),
      fetch("/api/org/providers").then((r) => r.json()),
    ])
      .then(([bsData, provData]) => {
        if (bsData.settings) setSettings(bsData.settings);
        setOrgName(bsData.orgName ?? "");
        setOrgSlug(bsData.orgSlug ?? "");
        setPhysicians(
          (provData.providers ?? []).map((p: Record<string, unknown>) => ({
            id: p.id,
            firstName: p.firstName,
            lastName: p.lastName,
            onlineBookingEnabled: p.onlineBookingEnabled ?? false,
          })),
        );
        setLoading(false);
      })
      .catch(() => {
        router.push("/org/login");
      });
  }, [router]);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  function togglePhysician(id: string, enabled: boolean) {
    setPhysicians((prev) =>
      prev.map((p) => (p.id === id ? { ...p, onlineBookingEnabled: enabled } : p)),
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);

    const res = await fetch("/api/org/booking-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgSlug,
        ...settings,
        physicianBookingToggles: physicians.map((p) => ({
          physicianId: p.id,
          enabled: p.onlineBookingEnabled,
        })),
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to save.");
    } else {
      setOrgSlug(data.orgSlug ?? orgSlug);
      setSaved(true);
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  const bookingUrl = orgSlug ? `${process.env.NEXT_PUBLIC_APP_URL ?? "https://mymd.health-asisst.org"}/booking/${orgSlug}` : null;

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <button onClick={() => router.push("/org/dashboard")} className="text-blue-600 text-sm mb-4">
          ← Dashboard
        </button>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Online Booking Settings</h1>
        <p className="text-gray-500 text-sm mb-8">{orgName}</p>

        {saved && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-green-700 text-sm mb-6">
            Settings saved successfully.
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm mb-6">
            {error}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-8">
          {/* Booking URL */}
          <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h2 className="font-semibold text-gray-800">Booking URL</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Clinic URL slug
              </label>
              <input
                type="text"
                value={orgSlug}
                onChange={(e) => setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="e.g. my-clinic"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {bookingUrl && orgSlug && (
                <p className="text-xs text-gray-400 mt-1">
                  Public URL:{" "}
                  <a href={bookingUrl} target="_blank" className="text-blue-600 underline">
                    {bookingUrl}
                  </a>
                </p>
              )}
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.onlineBookingEnabled}
                onChange={(e) => set("onlineBookingEnabled", e.target.checked)}
                className="accent-blue-600 w-4 h-4"
              />
              <span className="text-sm font-medium text-gray-700">Enable online booking</span>
            </label>
          </section>

          {/* Booking window */}
          <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h2 className="font-semibold text-gray-800">Public booking hours</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Opens at</label>
                <input
                  type="time"
                  value={settings.publicBookingStart}
                  onChange={(e) => set("publicBookingStart", e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Closes at</label>
                <input
                  type="time"
                  value={settings.publicBookingEnd}
                  onChange={(e) => set("publicBookingEnd", e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.enforceBookingWindow}
                onChange={(e) => set("enforceBookingWindow", e.target.checked)}
                className="accent-blue-600 w-4 h-4"
              />
              <span className="text-sm text-gray-700">
                Only allow bookings during these hours (enforce booking window)
              </span>
            </label>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
              <select
                value={settings.timezone}
                onChange={(e) => set("timezone", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
          </section>

          {/* Slot settings */}
          <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h2 className="font-semibold text-gray-800">Slot settings</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Default slot length</label>
              <select
                value={settings.slotIntervalMinutes}
                onChange={(e) => set("slotIntervalMinutes", Number(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {SLOT_INTERVALS.map((n) => (
                  <option key={n} value={n}>{n} minutes</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.showBlockedSlots}
                onChange={(e) => set("showBlockedSlots", e.target.checked)}
                className="accent-blue-600 w-4 h-4"
              />
              <span className="text-sm text-gray-700">Show blocked slots as unavailable (greyed out) to patients</span>
            </label>
          </section>

          {/* Patient info requirements */}
          <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h2 className="font-semibold text-gray-800">Patient information requirements</h2>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.healthCardRequired}
                onChange={(e) => set("healthCardRequired", e.target.checked)}
                className="accent-blue-600 w-4 h-4"
              />
              <span className="text-sm text-gray-700">Require health card number (PHN) at time of booking</span>
            </label>
          </section>

          {/* Text content */}
          <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h2 className="font-semibold text-gray-800">Text content</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Booking instructions (shown at top of booking page)
              </label>
              <textarea
                rows={3}
                value={settings.bookingInstructions ?? ""}
                onChange={(e) => set("bookingInstructions", e.target.value)}
                placeholder="e.g. For urgent care, please arrive early. Bring your health card."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cancellation policy (shown at bottom of booking pages)
              </label>
              <textarea
                rows={2}
                value={settings.cancellationPolicy ?? ""}
                onChange={(e) => set("cancellationPolicy", e.target.value)}
                placeholder="e.g. Please cancel at least 24 hours in advance."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </section>

          {/* Per-physician toggles */}
          {physicians.length > 0 && (
            <section className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="font-semibold text-gray-800 mb-4">
                Physician online booking access
              </h2>
              <div className="space-y-3">
                {physicians.map((p) => (
                  <label key={p.id} className="flex items-center justify-between gap-4 cursor-pointer">
                    <span className="text-sm text-gray-700">
                      Dr. {p.firstName} {p.lastName}
                    </span>
                    <input
                      type="checkbox"
                      checked={p.onlineBookingEnabled}
                      onChange={(e) => togglePhysician(p.id, e.target.checked)}
                      className="accent-blue-600 w-4 h-4"
                    />
                  </label>
                ))}
              </div>
            </section>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {saving ? "Saving…" : "Save Settings"}
          </button>
        </form>
      </div>
    </main>
  );
}
