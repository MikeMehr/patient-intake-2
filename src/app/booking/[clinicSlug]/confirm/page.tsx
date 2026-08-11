"use client";

import { use, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PharmacyPicker from "@/components/PharmacyPicker";
import {
  MODALITY_ICON,
  MODALITY_LABEL,
  MODALITY_NOTE,
  normalizeModality,
  type AppointmentModality,
} from "@/lib/appointment-modality";
import type { PharmacySelection } from "@/lib/pharmacy-selection";
import PoweredBy from "../../PoweredBy";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COVERAGE_OPTIONS = [
  { value: "CANADIAN_HEALTH_CARD", label: "Canadian health card (MSP/provincial)" },
  { value: "PRIVATE_PAY",          label: "Private pay (self-pay)" },
  { value: "TRAVEL_INSURANCE",     label: "Travel insurance" },
  { value: "UNINSURED",            label: "Uninsured / other" },
] as const;

// OSCAR's appointment.reason column is varchar(80). Cap here so what the patient
// types is exactly what the physician sees on the day sheet — no truncation.
const MAX_REASON_LEN = 80;

// Mirrors the server limits in /api/booking/manage/[token]/attachment so the patient
// is told here rather than by a 400 after their appointment is already booked.
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const PROVINCES = [
  "Alberta", "British Columbia", "Manitoba", "New Brunswick",
  "Newfoundland and Labrador", "Northwest Territories", "Nova Scotia",
  "Nunavut", "Ontario", "Prince Edward Island", "Quebec",
  "Saskatchewan", "Yukon",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ClinicSettings = {
  healthCardRequired: boolean;
  timezone: string;
  cancellationPolicy: string | null;
  appointmentModality: AppointmentModality;
  videoVisitsEnabled: boolean;
  patientMayChooseModality: boolean;
};

type Step =
  | "identity"        // Step 1: name / DOB / email
  | "looking-up"      // Spinner while Oscar is searched
  | "found"           // Oscar patient found — consent only
  | "not-found"       // Oscar not found — collect extra info + coverage
  | "no-oscar"        // Clinic has no Oscar connection — collect coverage
  | "blocked";        // Ambiguous or Oscar error — cannot proceed

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BookingConfirmPage({
  params,
}: {
  params: Promise<{ clinicSlug: string }>;
}) {
  const { clinicSlug } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();

  const slotId       = searchParams.get("slotId")    ?? "";
  const startTime    = searchParams.get("startTime")  ?? "";
  const physicianName = searchParams.get("physician") ?? "";

  const [settings, setSettings]     = useState<ClinicSettings | null>(null);
  const [clinicName, setClinicName] = useState("");
  const [step, setStep]             = useState<Step>("identity");

  // Identity (Step 1)
  const [identity, setIdentity] = useState({
    firstName: "", lastName: "", dateOfBirth: "", email: "",
  });

  // Reason for visit — written to OSCAR's appointment.reason (varchar(80)).
  const [reason, setReason] = useState("");

  // Optional photo/PDF of the complaint or a form. Uploaded after the booking is
  // committed, so a problem here never costs the patient their slot.
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  // Oscar result
  const [oscarDemographicNo, setOscarDemographicNo] = useState<string | null>(null);

  // Block message
  const [blockMessage, setBlockMessage]   = useState("");
  const [blockClinicEmail, setBlockClinicEmail] = useState<string | null>(null);

  // Extra info for new Oscar patients (Step 2 not-found)
  const [extra, setExtra] = useState({
    phone: "", email: "", address: "", city: "", province: "British Columbia", postal: "",
    gender: "", // OSCAR sex code: M | F | O | U
  });

  // How the patient wants to be seen. Only offered when the clinic allows a choice AND has
  // video enabled; otherwise the clinic default applies and this state is unused.
  const [chosenModality, setChosenModality] = useState<AppointmentModality>("PHONE");

  // Preferred pharmacy — new Oscar patients only. Existing patients may already have one set by
  // the clinic, and a public form must not silently replace it.
  const [pharmacy, setPharmacy] = useState<PharmacySelection | null>(null);

  // Coverage form (shown for not-found and no-oscar paths)
  const [coverage, setCoverage] = useState({
    coverageType: "CANADIAN_HEALTH_CARD",
    province: "British Columbia",
    healthCardNumber: "",
    healthCardVersion: "", // Ontario cards carry a 2-letter version code
    billingNote: "",
  });

  const [consentGiven, setConsentGiven] = useState(false);
  // Tri-state: null = not yet answered. The patient must pick one; "No" books fine.
  const [aiScribeConsent, setAiScribeConsent] = useState<boolean | null>(null);
  const [submitting, setSubmitting]     = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [success, setSuccess]           = useState<{ manageUrl: string } | null>(null);
  const [closeHint, setCloseHint]       = useState(false);

  // ---------------------------------------------------------------------------
  // Load clinic info
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!slotId) { router.replace(`/booking/${clinicSlug}`); return; }
    fetch(`/api/booking/${clinicSlug}/info`)
      .then((r) => r.json())
      .then((data) => {
        setSettings(data.settings);
        // Preselect the clinic's own default so a patient who never touches the picker books the
        // format the clinic expects.
        setChosenModality(normalizeModality(data.settings?.appointmentModality));
        setClinicName(data.clinic?.name ?? "");
      })
      .catch(() => {});
  }, [clinicSlug, slotId, router]);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function formatDateTime(iso: string): string {
    if (!iso || !settings) return iso;
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: settings.timezone,
        weekday: "long", month: "long", day: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true,
      }).format(new Date(iso));
    } catch { return iso; }
  }

  function setId(field: string, value: string) {
    setIdentity((p) => ({ ...p, [field]: value }));
  }

  function setCov(field: string, value: string) {
    setCoverage((p) => ({ ...p, [field]: value }));
  }

  function setEx(field: string, value: string) {
    setExtra((p) => ({ ...p, [field]: value }));
  }

  // ---------------------------------------------------------------------------
  // Step 1: Oscar lookup
  // ---------------------------------------------------------------------------

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    setStep("looking-up");
    setError(null);

    try {
      const res = await fetch(`/api/booking/${clinicSlug}/lookup-patient`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: identity.firstName.trim(),
          lastName:  identity.lastName.trim(),
          dateOfBirth: identity.dateOfBirth,
          email: identity.email.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setBlockMessage(
          data.error ?? "Something went wrong. Please try again or contact the clinic."
        );
        setStep("blocked");
        return;
      }

      if (!data.oscarConnected) {
        setStep("no-oscar");
        return;
      }

      if (data.found) {
        setOscarDemographicNo(data.demographicNo);
        setStep("found");
        return;
      }

      if (data.ambiguous) {
        setBlockMessage(
          "We found multiple records matching your information. Please contact the clinic directly to book your appointment."
        );
        setBlockClinicEmail(data.clinicEmail ?? null);
        setStep("blocked");
        return;
      }

      if (data.lookupError) {
        setBlockMessage(
          "We were unable to verify your patient record at this time. Please try again later or contact the clinic."
        );
        setBlockClinicEmail(data.clinicEmail ?? null);
        setStep("blocked");
        return;
      }

      // data.found === false
      setStep("not-found");
    } catch {
      setBlockMessage("A network error occurred. Please check your connection and try again.");
      setStep("blocked");
    }
  }

  // ---------------------------------------------------------------------------
  // Step 2: Submit booking
  // ---------------------------------------------------------------------------

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!consentGiven) { setError("You must consent to proceed."); return; }
    if (aiScribeConsent === null) { setError("Please answer the question about the AI scribe."); return; }
    setSubmitting(true);
    setError(null);

    let demographicNo = oscarDemographicNo;

    // For new Oscar patients, create the chart first
    if (step === "not-found" && !demographicNo) {
      const emailForOscar = identity.email.trim() || extra.email?.trim() || "";
      const createRes = await fetch(`/api/booking/${clinicSlug}/create-oscar-patient`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName:   identity.firstName.trim(),
          lastName:    identity.lastName.trim(),
          dateOfBirth: identity.dateOfBirth,
          email:       emailForOscar || undefined,
          phone:       extra.phone.trim(),
          address:     extra.address.trim(),
          city:        extra.city.trim(),
          province:    extra.province,
          postal:      extra.postal.trim(),
          gender:      extra.gender,
          healthCardNumber:   coverage.coverageType === "CANADIAN_HEALTH_CARD" && coverage.healthCardNumber.trim()
                                ? coverage.healthCardNumber.trim()
                                : undefined,
          healthCardProvince: coverage.coverageType === "CANADIAN_HEALTH_CARD" && coverage.healthCardNumber.trim()
                                ? coverage.province
                                : undefined,
          healthCardVersion:  coverage.coverageType === "CANADIAN_HEALTH_CARD" && coverage.healthCardNumber.trim() && coverage.healthCardVersion.trim()
                                ? coverage.healthCardVersion.trim()
                                : undefined,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) {
        setError(createData.error ?? "Failed to create patient record. Please try again.");
        setSubmitting(false);
        return;
      }
      demographicNo = createData.demographicNo ?? null;
    }

    // Determine what to submit for coverage
    const isExistingOscar = step === "found";
    const coverageType    = isExistingOscar ? "EXISTING_OSCAR_PATIENT" : coverage.coverageType;
    const emailToSubmit   = identity.email.trim() || extra.email.trim();

    const res = await fetch(`/api/booking/${clinicSlug}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slotId,
        firstName:        identity.firstName.trim(),
        lastName:         identity.lastName.trim(),
        dateOfBirth:      identity.dateOfBirth,
        email:            emailToSubmit,
        reason:           reason.trim(),
        coverageType,
        province:         !isExistingOscar && coverage.coverageType === "CANADIAN_HEALTH_CARD"
                            ? coverage.province
                            : undefined,
        healthCardNumber: !isExistingOscar && coverage.coverageType === "CANADIAN_HEALTH_CARD" && coverage.healthCardNumber.trim()
                            ? coverage.healthCardNumber.trim()
                            : undefined,
        billingNote:      !isExistingOscar && ["PRIVATE_PAY", "TRAVEL_INSURANCE", "UNINSURED"].includes(coverage.coverageType) && coverage.billingNote.trim()
                            ? coverage.billingNote.trim()
                            : undefined,
        consentGiven:     true,
        aiScribeConsent,  // real state — the guard above ensures it isn't null by now
        appointmentModality: modality,
        // Previously collected only on the "new to this clinic" branch and forwarded to OSCAR
        // without ever being kept. A video visit needs it to text a join link, and a phone visit
        // is nothing else.
        phone:            extra.phone.trim() || undefined,
        oscarDemographicNo: demographicNo ?? undefined,
        // Sent here rather than to create-oscar-patient: that route's body maps 1:1 onto OSCAR's
        // demographics payload, and chart creation must not depend on the pharmacy bridge being
        // up. Confirm persists the choice in the same statement that creates the booking, so even
        // a total bridge outage leaves staff a row to reconcile.
        pharmacy:         step === "not-found" ? pharmacy ?? undefined : undefined,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Something went wrong. Please try again.");
      setSubmitting(false);
      return;
    }

    // Attachments go up separately, after the slot is secured. Deliberately never fails
    // the booking: the patient keeps their appointment and is told to email the file
    // instead. Uses the manage token the confirm response just returned — no new secret.
    if (attachments.length && data.manageToken) {
      try {
        const form = new FormData();
        for (const file of attachments) form.append("files", file);
        const upRes = await fetch(`/api/booking/manage/${data.manageToken}/attachment`, {
          method: "POST",
          body: form,
        });
        if (!upRes.ok) {
          const upData = await upRes.json().catch(() => ({}));
          setAttachmentError(upData.error ?? "We couldn't upload your attachment.");
        }
      } catch {
        setAttachmentError("We couldn't upload your attachment.");
      }
    }

    setSuccess({ manageUrl: data.manageUrl });
    setSubmitting(false);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // The clinic setting is the default; the patient may move off it only when the clinic has
  // switched that on. The server clamps this again — a public form's choice is a request, not a
  // decision.
  const clinicDefault = normalizeModality(settings?.appointmentModality);
  const mayChoose = Boolean(settings?.patientMayChooseModality && settings?.videoVisitsEnabled);
  const modality = mayChoose ? chosenModality : clinicDefault;

  /**
   * Format picker. Only rendered when the clinic both allows a choice and has video switched on,
   * so a clinic that hasn't set up video never shows an option that would fail. The banner below
   * reacts to the selection, which is the point — the patient sees what they've just chosen means.
   */
  const modalityPicker = mayChoose ? (
    <fieldset className="text-left">
      <legend className="text-sm font-medium text-gray-700 mb-2">
        How would you like to be seen?
      </legend>
      <div className="grid grid-cols-2 gap-2">
        {(["PHONE", "VIDEO"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setChosenModality(m)}
            aria-pressed={modality === m}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition ${
              modality === m
                ? "border-blue-500 bg-blue-50 text-blue-900"
                : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
            }`}
          >
            <span aria-hidden>{MODALITY_ICON[m]}</span>
            {m === "PHONE" ? "Phone call" : "Video call"}
          </button>
        ))}
      </div>
    </fieldset>
  ) : null;

  /** Format banner — patients must never be unsure whether to expect a call. */
  const modalityBanner = (
    <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg p-3 text-left">
      <span aria-hidden className="text-base leading-none mt-0.5">{MODALITY_ICON[modality]}</span>
      <div>
        <p className="text-sm font-semibold text-blue-900">{MODALITY_LABEL[modality]}</p>
        <p className="text-xs text-blue-800 mt-0.5">{MODALITY_NOTE[modality]}</p>
      </div>
    </div>
  );

  if (success) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
          <div className="text-green-500 text-5xl mb-4">✓</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Appointment Confirmed</h2>
          <p className="text-gray-600 mb-1">{clinicName}</p>
          <p className="text-gray-600 mb-1">{physicianName}</p>
          <p className="font-semibold text-gray-800 mb-4">{formatDateTime(startTime)}</p>
          <div className="mb-6">{modalityBanner}</div>
          {attachmentError && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-sm text-left mb-6">
              Your appointment is confirmed, but we couldn&apos;t upload your attachment. Please
              email it to the clinic instead.
            </div>
          )}
          <p className="text-sm text-gray-500 mb-6">
            A confirmation email has been sent. Use the link below to view or cancel your appointment.
          </p>
          <a
            href={success.manageUrl}
            className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            Manage Appointment
          </a>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => {
                // window.close() only works for tabs opened by script. Patients
                // arrive here via a normal link, so the browser silently ignores
                // it — if we're still running after the call, show guidance.
                window.close();
                setCloseHint(true);
              }}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              Close window
            </button>
            {closeHint && (
              <p className="text-xs text-gray-400 mt-2">
                You can now close this browser tab.
              </p>
            )}
          </div>
          <PoweredBy />
        </div>
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: appointment summary (shared header)
  // ---------------------------------------------------------------------------

  const appointmentSummary = (
    <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6">
      <p className="font-semibold text-blue-900">{clinicName}</p>
      {physicianName && <p className="text-blue-700 text-sm">{physicianName}</p>}
      {startTime && (
        <p className="text-blue-800 font-medium text-sm mt-1">{formatDateTime(startTime)}</p>
      )}
      <p className="text-blue-800 text-sm mt-1">
        <span aria-hidden>{MODALITY_ICON[modality]}</span> {MODALITY_LABEL[modality]} —{" "}
        <span className="text-blue-700">{MODALITY_NOTE[modality]}</span>
      </p>
      <p className="text-xs text-blue-500 mt-2">
        Your selected time is held for 5 minutes. Please complete this form promptly.
      </p>
    </div>
  );

  const reasonField = (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Reason for visit *</label>
      <input
        required
        type="text"
        maxLength={MAX_REASON_LEN}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. sore throat and fever, 3 days"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <p className="text-xs text-gray-400 mt-1">
        Briefly tell the physician why you&apos;re booking — e.g. sore throat, medication refill.
      </p>
    </div>
  );

  function handleAttachmentChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length > MAX_ATTACHMENTS) {
      setAttachmentError(`You can attach at most ${MAX_ATTACHMENTS} files.`);
      setAttachments([]);
      e.target.value = "";
      return;
    }
    const tooBig = picked.find((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (tooBig) {
      setAttachmentError(`"${tooBig.name}" is larger than the 10 MB limit.`);
      setAttachments([]);
      e.target.value = "";
      return;
    }
    setAttachmentError(null);
    setAttachments(picked);
  }

  const attachmentField = (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Attach a photo or PDF (optional)
      </label>
      <input
        type="file"
        accept="image/*,application/pdf"
        multiple
        onChange={handleAttachmentChange}
        className="w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
      />
      <p className="text-xs text-gray-400 mt-1">
        A form to bring to your visit, or a photo of your complaint. Up to {MAX_ATTACHMENTS} files,
        10 MB each.
      </p>
      {attachmentError && (
        <p className="text-xs text-red-600 mt-1">{attachmentError}</p>
      )}
    </div>
  );

  // AI-scribe question. Deliberately tri-state — "No" is a valid answer that books fine; the
  // refusal is recorded so the doctor knows not to use the tool for this visit.
  const aiScribeField = (
    <fieldset className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-left">
      <legend className="sr-only">AI scribe consent</legend>
      <p className="text-sm text-gray-600">
        Our doctors may use an AI scribe tool during visits to help write the visit note. Your
        doctor reviews everything it produces. Is it okay for your doctor to use this tool during
        your visit? *
      </p>
      <div className="flex gap-6 mt-3">
        {([
          ["yes", true, "Yes, that's fine"],
          ["no", false, "No, please don't"],
        ] as const).map(([key, value, label]) => (
          <label key={key} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
            <input
              type="radio"
              name="aiScribeConsent"
              required
              checked={aiScribeConsent === value}
              onChange={() => setAiScribeConsent(value)}
              className="accent-blue-600"
            />
            {label}
          </label>
        ))}
      </div>
      <p className="text-xs text-gray-400 mt-2">
        You can say no — it will not affect your appointment or your care.
      </p>
    </fieldset>
  );

  // ---------------------------------------------------------------------------
  // Render: Step 1 — identity form
  // ---------------------------------------------------------------------------

  if (step === "identity" || step === "looking-up") {
    return (
      <main className="min-h-screen bg-gray-50 py-10 px-4">
        <div className="max-w-lg mx-auto">
          <button
            onClick={() => router.push(`/booking/${clinicSlug}`)}
            className="text-blue-600 text-sm mb-4"
          >
            ← Back to time selection
          </button>

          {appointmentSummary}

          <h1 className="text-xl font-bold text-gray-900 mb-6">Your information</h1>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleLookup} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">First name *</label>
                <input
                  required
                  type="text"
                  value={identity.firstName}
                  onChange={(e) => setId("firstName", e.target.value)}
                  disabled={step === "looking-up"}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last name *</label>
                <input
                  required
                  type="text"
                  value={identity.lastName}
                  onChange={(e) => setId("lastName", e.target.value)}
                  disabled={step === "looking-up"}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date of birth *</label>
              <input
                required
                type="date"
                value={identity.dateOfBirth}
                onChange={(e) => setId("dateOfBirth", e.target.value)}
                max={new Date().toISOString().substring(0, 10)}
                disabled={step === "looking-up"}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
              <input
                type="email"
                value={identity.email}
                onChange={(e) => setId("email", e.target.value)}
                disabled={step === "looking-up"}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              />
              <p className="text-xs text-gray-400 mt-1">
                Helps find your record and receive a confirmation. Leave blank to search by name and date of birth only.
              </p>
            </div>

            <button
              type="submit"
              disabled={step === "looking-up"}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {step === "looking-up" ? "Checking your record…" : "Next"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: blocked (ambiguous or Oscar error)
  // ---------------------------------------------------------------------------

  if (step === "blocked") {
    return (
      <main className="min-h-screen bg-gray-50 py-10 px-4">
        <div className="max-w-lg mx-auto">
          <button
            onClick={() => router.push(`/booking/${clinicSlug}`)}
            className="text-blue-600 text-sm mb-4"
          >
            ← Back to time selection
          </button>

          {appointmentSummary}

          <div className="bg-red-50 border border-red-200 rounded-xl p-5 space-y-3">
            <p className="text-red-800 font-medium">{blockMessage}</p>
            {blockClinicEmail && (
              <p className="text-sm text-red-700">
                Contact the clinic:{" "}
                <a href={`mailto:${blockClinicEmail}`} className="underline">
                  {blockClinicEmail}
                </a>
              </p>
            )}
          </div>

          <button
            onClick={() => { setStep("identity"); setError(null); }}
            className="mt-4 text-blue-600 text-sm"
          >
            ← Try different information
          </button>
        </div>
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Step 2 — existing Oscar patient (consent only)
  // ---------------------------------------------------------------------------

  if (step === "found") {
    return (
      <main className="min-h-screen bg-gray-50 py-10 px-4">
        <div className="max-w-lg mx-auto">
          <button
            onClick={() => { setStep("identity"); setConsentGiven(false); setAiScribeConsent(null); setError(null); }}
            className="text-blue-600 text-sm mb-4"
          >
            ← Back
          </button>

          {appointmentSummary}

          <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 flex items-start gap-3">
            <span className="text-green-600 text-xl mt-0.5">✓</span>
            <div>
              <p className="text-green-800 font-medium text-sm">Your patient record was found.</p>
              <p className="text-green-700 text-xs mt-1">
                {identity.firstName} {identity.lastName} — your information is on file with the clinic.
              </p>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {reasonField}
            {attachmentField}
            {modalityPicker}
            {modalityBanner}
            {aiScribeField}

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
                  checked={consentGiven}
                  onChange={(e) => setConsentGiven(e.target.checked)}
                  className="mt-0.5 accent-blue-600"
                />
                <span>
                  I consent to the collection and use of my information for booking and care purposes. *
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={submitting || !consentGiven || aiScribeConsent === null}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {submitting ? "Confirming…" : "Confirm Appointment"}
            </button>
          </form>
          <PoweredBy />
        </div>
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Step 2 — new patient (not-found) OR no-oscar (coverage form)
  // ---------------------------------------------------------------------------

  const isNewOscarPatient = step === "not-found";

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-lg mx-auto">
        <button
          onClick={() => { setStep("identity"); setConsentGiven(false); setAiScribeConsent(null); setError(null); }}
          className="text-blue-600 text-sm mb-4"
        >
          ← Back
        </button>

        {appointmentSummary}

        {isNewOscarPatient && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6 text-sm text-blue-800">
            We couldn&apos;t find an existing record for {identity.firstName} {identity.lastName}.
            Please provide a few more details — a new patient chart will be created.
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {reasonField}
          {attachmentField}
          {modalityPicker}
          {modalityBanner}

          {/* Extra info for new Oscar patients */}
          {isNewOscarPatient && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone number *</label>
                <input
                  required
                  type="tel"
                  value={extra.phone}
                  onChange={(e) => setEx("phone", e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Gender *</label>
                <select
                  required
                  value={extra.gender}
                  onChange={(e) => setEx("gender", e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="" disabled>Select…</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="O">Other</option>
                  <option value="U">Prefer not to say</option>
                </select>
              </div>

              {/* Show email field if not provided in Step 1 */}
              {!identity.email.trim() && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email address *</label>
                  <input
                    required
                    type="email"
                    value={extra.email ?? ""}
                    onChange={(e) => setEx("email", e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">Confirmation will be sent to this address.</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Home address *</label>
                <input
                  required
                  type="text"
                  placeholder="Street address"
                  value={extra.address}
                  onChange={(e) => setEx("address", e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City *</label>
                  <input
                    required
                    type="text"
                    value={extra.city}
                    onChange={(e) => setEx("city", e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Postal code *</label>
                  <input
                    required
                    type="text"
                    value={extra.postal}
                    onChange={(e) => setEx("postal", e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Province *</label>
                <select
                  required
                  value={extra.province}
                  onChange={(e) => setEx("province", e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <PharmacyPicker
                clinicSlug={clinicSlug}
                value={pharmacy}
                onChange={setPharmacy}
              />
            </>
          )}

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
                    checked={coverage.coverageType === opt.value}
                    onChange={() => setCov("coverageType", opt.value)}
                    className="accent-blue-600"
                  />
                  <span className="text-sm text-gray-700">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Province for health card */}
          {coverage.coverageType === "CANADIAN_HEALTH_CARD" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Province / territory *</label>
              <select
                required
                value={coverage.province}
                onChange={(e) => setCov("province", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          )}

          {/* Health card number */}
          {coverage.coverageType === "CANADIAN_HEALTH_CARD" && settings?.healthCardRequired && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Health card number (PHN) *
              </label>
              <input
                required
                type="text"
                value={coverage.healthCardNumber}
                onChange={(e) => setCov("healthCardNumber", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Version code — Ontario health cards only */}
          {coverage.coverageType === "CANADIAN_HEALTH_CARD" &&
            settings?.healthCardRequired &&
            coverage.province === "Ontario" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Version code
              </label>
              <input
                type="text"
                maxLength={2}
                value={coverage.healthCardVersion}
                onChange={(e) => setCov("healthCardVersion", e.target.value.toUpperCase())}
                placeholder="2 letters, e.g. AB"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                The two letters printed after your health card number.
              </p>
            </div>
          )}

          {/* Billing note */}
          {["PRIVATE_PAY", "TRAVEL_INSURANCE", "UNINSURED"].includes(coverage.coverageType) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Billing note (optional)
              </label>
              <textarea
                value={coverage.billingNote}
                onChange={(e) => setCov("billingNote", e.target.value)}
                rows={2}
                placeholder="e.g. insurance provider name, policy number…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {aiScribeField}

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
                checked={consentGiven}
                onChange={(e) => setConsentGiven(e.target.checked)}
                className="mt-0.5 accent-blue-600"
              />
              <span>
                I consent to the collection and use of my information for booking and care purposes. *
              </span>
            </label>
          </div>

          <button
            type="submit"
            disabled={submitting || !consentGiven || aiScribeConsent === null}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {submitting
              ? isNewOscarPatient
                ? "Creating record & confirming…"
                : "Confirming…"
              : "Confirm Appointment"}
          </button>
        </form>
        <PoweredBy />
      </div>
    </main>
  );
}
