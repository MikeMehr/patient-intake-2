"use client";

import { use, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const COVERAGE_OPTIONS = [
  { value: "CANADIAN_HEALTH_CARD", label: "Canadian health card (MSP/provincial)" },
  { value: "PRIVATE_PAY", label: "Private pay (self-pay)" },
  { value: "TRAVEL_INSURANCE", label: "Travel insurance" },
  { value: "UNINSURED", label: "Uninsured / other" },
] as const;

const PROVINCES = [
  "Alberta", "British Columbia", "Manitoba", "New Brunswick",
  "Newfoundland and Labrador", "Northwest Territories", "Nova Scotia",
  "Nunavut", "Ontario", "Prince Edward Island", "Quebec",
  "Saskatchewan", "Yukon",
];

type ClinicSettings = {
  healthCardRequired: boolean;
  timezone: string;
  cancellationPolicy: string | null;
};

export default function BookingConfirmPage({
  params,
}: {
  params: Promise<{ clinicSlug: string }>;
}) {
  const { clinicSlug } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();

  const slotId = searchParams.get("slotId") ?? "";
  const startTime = searchParams.get("startTime") ?? "";
  const physicianName = searchParams.get("physician") ?? "";

  const [settings, setSettings] = useState<ClinicSettings | null>(null);
  const [clinicName, setClinicName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ manageUrl: string } | null>(null);

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    email: "",
    coverageType: "CANADIAN_HEALTH_CARD",
    province: "British Columbia",
    healthCardNumber: "",
    billingNote: "",
    consentGiven: false,
  });

  useEffect(() => {
    if (!slotId) {
      router.replace(`/booking/${clinicSlug}`);
      return;
    }
    fetch(`/api/booking/${clinicSlug}/info`)
      .then((r) => r.json())
      .then((data) => {
        setSettings(data.settings);
        setClinicName(data.clinic?.name ?? "");
      })
      .catch(() => {});
  }, [clinicSlug, slotId, router]);

  function formatDateTime(iso: string): string {
    if (!iso || !settings) return iso;
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: settings.timezone,
        weekday: "long",
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

  function set(field: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.consentGiven) {
      setError("You must consent to proceed.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const res = await fetch(`/api/booking/${clinicSlug}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slotId,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        dateOfBirth: form.dateOfBirth,
        email: form.email.trim(),
        coverageType: form.coverageType,
        province: form.coverageType === "CANADIAN_HEALTH_CARD" ? form.province : undefined,
        healthCardNumber:
          form.coverageType === "CANADIAN_HEALTH_CARD" && form.healthCardNumber.trim()
            ? form.healthCardNumber.trim()
            : undefined,
        billingNote:
          ["PRIVATE_PAY", "TRAVEL_INSURANCE", "UNINSURED"].includes(form.coverageType) && form.billingNote.trim()
            ? form.billingNote.trim()
            : undefined,
        consentGiven: form.consentGiven,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Something went wrong. Please try again.");
      setSubmitting(false);
      return;
    }

    setSuccess({ manageUrl: data.manageUrl });
    setSubmitting(false);
  }

  if (success) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
          <div className="text-green-500 text-5xl mb-4">✓</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Appointment Confirmed</h2>
          <p className="text-gray-600 mb-1">{clinicName}</p>
          <p className="text-gray-600 mb-1">{physicianName}</p>
          <p className="font-semibold text-gray-800 mb-6">{formatDateTime(startTime)}</p>
          <p className="text-sm text-gray-500 mb-6">
            A confirmation email has been sent. Use the link below to view or cancel your appointment.
          </p>
          <a
            href={success.manageUrl}
            className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            Manage Appointment
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-lg mx-auto">
        <button
          onClick={() => router.push(`/booking/${clinicSlug}`)}
          className="text-blue-600 text-sm mb-4"
        >
          ← Back to time selection
        </button>

        {/* Appointment summary */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6">
          <p className="font-semibold text-blue-900">{clinicName}</p>
          {physicianName && <p className="text-blue-700 text-sm">{physicianName}</p>}
          {startTime && (
            <p className="text-blue-800 font-medium text-sm mt-1">{formatDateTime(startTime)}</p>
          )}
          <p className="text-xs text-blue-500 mt-2">
            Your selected time is held for 5 minutes. Please complete this form promptly.
          </p>
        </div>

        <h1 className="text-xl font-bold text-gray-900 mb-6">Your information</h1>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">First name *</label>
              <input
                required
                type="text"
                value={form.firstName}
                onChange={(e) => set("firstName", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last name *</label>
              <input
                required
                type="text"
                value={form.lastName}
                onChange={(e) => set("lastName", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date of birth *</label>
            <input
              required
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => set("dateOfBirth", e.target.value)}
              max={new Date().toISOString().substring(0, 10)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email address *</label>
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">Confirmation will be sent to this address.</p>
          </div>

          {/* Coverage type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Coverage type *</label>
            <div className="space-y-2">
              {COVERAGE_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="coverageType"
                    value={opt.value}
                    checked={form.coverageType === opt.value}
                    onChange={() => set("coverageType", opt.value)}
                    className="accent-blue-600"
                  />
                  <span className="text-sm text-gray-700">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Province (Canadian health card) */}
          {form.coverageType === "CANADIAN_HEALTH_CARD" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Province / territory *</label>
              <select
                required
                value={form.province}
                onChange={(e) => set("province", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {PROVINCES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          )}

          {/* Health card number (conditional) */}
          {form.coverageType === "CANADIAN_HEALTH_CARD" && settings?.healthCardRequired && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Health card number (PHN) *
              </label>
              <input
                required
                type="text"
                value={form.healthCardNumber}
                onChange={(e) => set("healthCardNumber", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Billing note (non-insured) */}
          {["PRIVATE_PAY", "TRAVEL_INSURANCE", "UNINSURED"].includes(form.coverageType) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Billing note (optional)
              </label>
              <textarea
                value={form.billingNote}
                onChange={(e) => set("billingNote", e.target.value)}
                rows={2}
                placeholder="e.g. insurance provider name, policy number…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Consent */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-600 space-y-2">
            <p>
              Your personal and health information will be collected by the clinic for the purpose of
              scheduling and providing medical care. It will be handled in accordance with applicable
              provincial privacy legislation (PIPA / PHIPA).
            </p>
            {settings?.cancellationPolicy && (
              <p className="text-xs text-gray-500">{settings.cancellationPolicy}</p>
            )}
            <label className="flex items-start gap-3 cursor-pointer mt-3">
              <input
                type="checkbox"
                checked={form.consentGiven}
                onChange={(e) => set("consentGiven", e.target.checked)}
                className="mt-0.5 accent-blue-600"
              />
              <span>
                I consent to the collection and use of my information for booking and care purposes. *
              </span>
            </label>
          </div>

          <button
            type="submit"
            disabled={submitting || !form.consentGiven}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {submitting ? "Confirming…" : "Confirm Appointment"}
          </button>
        </form>
      </div>
    </main>
  );
}
