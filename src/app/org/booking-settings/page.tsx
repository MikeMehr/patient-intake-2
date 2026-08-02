"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TimeField from "@/components/TimeField";
import {
  APPOINTMENT_MODALITIES,
  DEFAULT_APPOINTMENT_MODALITY,
  MODALITY_LABEL,
  MODALITY_NOTE,
  normalizeModality,
  type AppointmentModality,
} from "@/lib/appointment-modality";

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
  appointmentModality: AppointmentModality;
  videoVisitsEnabled: boolean;
  patientMayChooseModality: boolean;
  cancellationPolicy: string | null;
  bookingInstructions: string | null;
  emailFooter: string | null;
  timezone: string;
  selfServeInterviewEnabled: boolean;
  selfServeInterviewPhysicianId: string | null;
};

type PharmacyDirectoryState = {
  count: number;
  lastSuccessAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
};

function describeSyncAge(iso: string | null): string {
  if (!iso) return "never synced";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "synced today";
  if (days === 1) return "synced yesterday";
  return `synced ${days} days ago`;
}

export default function BookingSettingsPage() {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [orgWebsite, setOrgWebsite] = useState("");
  const [physicians, setPhysicians] = useState<Physician[]>([]);
  const [settings, setSettings] = useState<Settings>({
    onlineBookingEnabled: false,
    publicBookingStart: "07:00",
    publicBookingEnd: "22:00",
    enforceBookingWindow: true,
    slotIntervalMinutes: 15,
    healthCardRequired: false,
    showBlockedSlots: false,
    appointmentModality: DEFAULT_APPOINTMENT_MODALITY,
    videoVisitsEnabled: false,
    patientMayChooseModality: false,
    cancellationPolicy: "",
    bookingInstructions: "",
    emailFooter: "",
    timezone: "America/Vancouver",
    selfServeInterviewEnabled: false,
    selfServeInterviewPhysicianId: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pharmacyState, setPharmacyState] = useState<PharmacyDirectoryState | null>(null);
  const [syncingPharmacies, setSyncingPharmacies] = useState(false);
  const [pharmacySyncError, setPharmacySyncError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/org/booking-settings").then((r) => r.json()),
      fetch("/api/org/providers").then((r) => r.json()),
    ])
      .then(([bsData, provData]) => {
        if (bsData.settings) setSettings(bsData.settings);
        setOrgName(bsData.orgName ?? "");
        setOrgSlug(bsData.orgSlug ?? "");
        setOrgWebsite(bsData.orgWebsiteUrl ?? "");
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

    // Separate from the Promise.all above on purpose: an unconfigured pharmacy bridge must not
    // bounce the admin to the login page along with a genuine auth failure.
    fetch("/api/org/pharmacy-directory/sync")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setPharmacyState(data);
      })
      .catch(() => {});
  }, [router]);

  async function handleSyncPharmacies() {
    setSyncingPharmacies(true);
    setPharmacySyncError(null);
    try {
      const res = await fetch("/api/org/pharmacy-directory/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setPharmacySyncError(data.error ?? "Sync failed");
      } else {
        setPharmacyState({
          count: data.count,
          lastSuccessAt: data.lastSuccessAt,
          lastStatus: "OK",
          lastError: null,
        });
      }
    } catch {
      setPharmacySyncError("Sync failed. Please try again.");
    } finally {
      setSyncingPharmacies(false);
    }
  }

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
        websiteUrl: orgWebsite,
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
      setOrgWebsite(data.orgWebsiteUrl ?? orgWebsite);
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

  const bookingUrl = orgSlug ? `${process.env.NEXT_PUBLIC_APP_URL ?? "https://physician.health-assist.org"}/booking/${orgSlug}` : null;

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

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Clinic website
              </label>
              <input
                type="text"
                value={orgWebsite}
                onChange={(e) => setOrgWebsite(e.target.value)}
                placeholder="e.g. https://yourclinic.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                Your clinic&apos;s public website. The clinic name on the booking and interview
                pages links here. Leave blank for no link.
              </p>
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
                <TimeField
                  value={settings.publicBookingStart}
                  onChange={(v) => set("publicBookingStart", v)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Closes at</label>
                <TimeField
                  value={settings.publicBookingEnd}
                  onChange={(v) => set("publicBookingEnd", v)}
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Default appointment format</label>
              <select
                value={settings.appointmentModality}
                onChange={(e) => set("appointmentModality", normalizeModality(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {APPOINTMENT_MODALITIES.map((m) => (
                  <option key={m} value={m}>{MODALITY_LABEL[m]}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                {MODALITY_NOTE[settings.appointmentModality]}
              </p>
            </div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.videoVisitsEnabled}
                onChange={(e) => set("videoVisitsEnabled", e.target.checked)}
                className="mt-0.5 w-4 h-4 text-blue-600 border-gray-300 rounded"
              />
              <span>
                <span className="text-sm text-gray-700">Enable video visits</span>
                <span className="block text-xs text-gray-500">
                  Patients get a link to join by video, and providers get a video button beside
                  each patient on the OSCAR day sheet.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.patientMayChooseModality}
                disabled={!settings.videoVisitsEnabled}
                onChange={(e) => set("patientMayChooseModality", e.target.checked)}
                className="mt-0.5 w-4 h-4 text-blue-600 border-gray-300 rounded disabled:opacity-40"
              />
              <span>
                <span className="text-sm text-gray-700">Let patients choose phone or video</span>
                <span className="block text-xs text-gray-500">
                  When off, every booking uses the default format above. Requires video visits to
                  be enabled.
                </span>
              </span>
            </label>
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email footer (added to the bottom of confirmation &amp; cancellation emails)
              </label>
              <textarea
                rows={8}
                value={settings.emailFooter ?? ""}
                onChange={(e) => set("emailFooter", e.target.value)}
                placeholder={
                  "MyMD Medical Clinic\n\nOffice line: 604-880-7919\nFax: 604-628-3830\n\nThis e-mail and any files transmitted with it are confidential and intended only for the addressee. If you received it in error, please notify the sender and delete it."
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                Plain text. Line breaks are preserved in the email.
              </p>
            </div>
          </section>

          {/* Per-physician toggles */}
          {physicians.length > 0 && (
            <section className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="font-semibold text-gray-800 mb-1">
                Physician online booking access
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                (Checked = patients can book this doctor online. Unchecked = doctor
                is hidden from the public booking page entirely.)
              </p>
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

          {/* Self-serve AI Guided Interview */}
          <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h2 className="font-semibold text-gray-800">AI Guided Interview (self-serve)</h2>
            <p className="text-sm text-gray-500">
              Let patients start an AI guided interview directly (no physician invite),
              from a public link on your website. Returning patients are matched to their
              existing chart; new patients enter their details and a chart is created only
              after they complete the interview.
            </p>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.selfServeInterviewEnabled}
                onChange={(e) => set("selfServeInterviewEnabled", e.target.checked)}
                className="accent-blue-600 w-4 h-4"
              />
              <span className="text-sm font-medium text-gray-700">
                Enable self-serve AI guided interview
              </span>
            </label>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Default physician for self-serve interviews
              </label>
              <select
                value={settings.selfServeInterviewPhysicianId ?? ""}
                onChange={(e) =>
                  set("selfServeInterviewPhysicianId", e.target.value || null)
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Select a physician —</option>
                {physicians.map((p) => (
                  <option key={p.id} value={p.id}>
                    Dr. {p.firstName} {p.lastName}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Self-serve interviews are attached to this physician. Required for the
                feature to be live.
              </p>
            </div>

            {orgSlug && settings.selfServeInterviewEnabled && settings.selfServeInterviewPhysicianId && (
              <p className="text-xs text-gray-400">
                Public URL:{" "}
                <a
                  href={`${process.env.NEXT_PUBLIC_APP_URL ?? "https://physician.health-assist.org"}/interview/${orgSlug}`}
                  target="_blank"
                  className="text-blue-600 underline"
                >
                  {`${process.env.NEXT_PUBLIC_APP_URL ?? "https://physician.health-assist.org"}/interview/${orgSlug}`}
                </a>
              </p>
            )}
          </section>

          {/* Pharmacy directory mirror */}
          <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h2 className="font-semibold text-gray-800">Pharmacy directory</h2>
            <p className="text-sm text-gray-500">
              New patients booking online can choose their preferred pharmacy, and it is set on
              their chart in OSCAR. The list they search is a copy of your OSCAR pharmacy
              directory — sync it here after adding pharmacies in OSCAR. It also refreshes
              automatically each week.
            </p>

            <div className="flex items-center justify-between gap-4 flex-wrap">
              <p className="text-sm text-gray-700">
                {pharmacyState && pharmacyState.count > 0 ? (
                  <>
                    <span className="font-medium">
                      {pharmacyState.count.toLocaleString()} pharmacies
                    </span>{" "}
                    <span className="text-gray-500">
                      — {describeSyncAge(pharmacyState.lastSuccessAt)}
                    </span>
                  </>
                ) : (
                  <span className="text-gray-500">
                    Not synced yet. Patients can still type a pharmacy name by hand.
                  </span>
                )}
              </p>
              {/* type="button" — this sits inside the settings form and must not submit it. */}
              <button
                type="button"
                onClick={handleSyncPharmacies}
                disabled={syncingPharmacies}
                className="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-900 disabled:opacity-50 transition"
              >
                {syncingPharmacies ? "Syncing…" : "Sync from OSCAR"}
              </button>
            </div>

            {pharmacySyncError && (
              <p className="text-sm text-red-600">{pharmacySyncError}</p>
            )}
            {!pharmacySyncError && pharmacyState?.lastStatus === "FAILED" && pharmacyState.lastError && (
              <p className="text-sm text-amber-700">
                Last sync failed: {pharmacyState.lastError}
              </p>
            )}
          </section>

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
