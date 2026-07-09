"use client";

import { use, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

const PROVINCES = [
  "Alberta", "British Columbia", "Manitoba", "New Brunswick",
  "Newfoundland and Labrador", "Northwest Territories", "Nova Scotia",
  "Nunavut", "Ontario", "Prince Edward Island", "Quebec",
  "Saskatchewan", "Yukon",
];

const COVERAGE_OPTIONS = [
  { value: "CANADIAN_HEALTH_CARD", label: "Canadian health card (MSP/provincial)" },
  { value: "PRIVATE_PAY", label: "Private pay (self-pay)" },
  { value: "TRAVEL_INSURANCE", label: "Travel insurance" },
  { value: "UNINSURED", label: "Uninsured / other" },
] as const;

type Step = "identity" | "demographics" | "otp" | "blocked" | "unavailable";

type VerifyOtpResponse = {
  success: boolean;
  patientName: string;
  patientEmail: string;
  patientDob: string | null;
  physicianId: string;
  physicianName: string;
  clinicName: string;
  organizationWebsiteUrl: string | null;
};

export default function SelfServeInterviewPage({
  params,
}: {
  params: Promise<{ clinicSlug: string }>;
}) {
  const { clinicSlug } = use(params);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("identity");
  const [clinicName, setClinicName] = useState("");
  const [physicianName, setPhysicianName] = useState("");

  const [identity, setIdentity] = useState({
    firstName: "", lastName: "", dateOfBirth: "", email: "", phone: "",
  });
  const [demographics, setDemographics] = useState({
    gender: "", address: "", city: "", province: "British Columbia", postal: "",
    coverageType: "CANADIAN_HEALTH_CARD", healthCardNumber: "",
  });

  const [token, setToken] = useState("");
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpMessage, setOtpMessage] = useState<string | null>(null);

  const [blockMessage, setBlockMessage] = useState("");
  const [blockClinicEmail, setBlockClinicEmail] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const otpRequestedRef = useRef(false);

  // Load clinic info + feature gate.
  useEffect(() => {
    fetch(`/api/interview-intake/${clinicSlug}/info`)
      .then((r) => r.json())
      .then((data) => {
        setClinicName(data.clinicName ?? "");
        setPhysicianName(data.physicianName ?? "");
        if (!data.enabled) setStep("unavailable");
        setLoading(false);
      })
      .catch(() => {
        setStep("unavailable");
        setLoading(false);
      });
  }, [clinicSlug]);

  useEffect(() => {
    if (verified) router.replace("/");
  }, [verified, router]);

  function setId(field: keyof typeof identity, value: string) {
    setIdentity((p) => ({ ...p, [field]: value }));
  }
  function setDemo(field: keyof typeof demographics, value: string) {
    setDemographics((p) => ({ ...p, [field]: value }));
  }

  function persistInviteSession(data: VerifyOtpResponse) {
    if (typeof window === "undefined") return;
    sessionStorage.setItem("physicianId", data.physicianId);
    sessionStorage.setItem("physicianName", data.physicianName);
    sessionStorage.setItem("clinicName", data.clinicName);
    sessionStorage.setItem("invitedFlow", "true");
    sessionStorage.setItem("invitePatientName", data.patientName);
    sessionStorage.setItem("invitePatientEmail", data.patientEmail);
    sessionStorage.setItem("invitePatientDob", data.patientDob || "");
    sessionStorage.setItem("organizationWebsiteUrl", data.organizationWebsiteUrl || "");
  }

  // Step 1: start — OSCAR lookup + create invitation.
  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/interview-intake/${clinicSlug}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: identity.firstName.trim(),
          lastName: identity.lastName.trim(),
          email: identity.email.trim(),
          phone: identity.phone.trim(),
          dateOfBirth: identity.dateOfBirth,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      if (data.blocked) {
        setBlockMessage(
          "We couldn’t confirm your record automatically. Please contact the clinic to continue.",
        );
        setBlockClinicEmail(data.clinicEmail ?? null);
        setStep("blocked");
        return;
      }
      setToken(data.rawToken);
      setMaskedPhone(data.maskedPhone ?? null);
      if (data.patientType === "new") {
        setStep("demographics");
      } else {
        setStep("otp");
      }
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Step 2 (new patients): submit demographics, then move to OTP.
  async function handleDemographics(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/interview-intake/${clinicSlug}/demographics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          gender: demographics.gender,
          address: demographics.address.trim(),
          city: demographics.city.trim(),
          province: demographics.province,
          postal: demographics.postal.trim(),
          coverageType: demographics.coverageType,
          healthCardNumber:
            demographics.coverageType === "CANADIAN_HEALTH_CARD"
              ? demographics.healthCardNumber.trim() || undefined
              : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save your details. Please try again.");
        return;
      }
      setStep("otp");
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Request an OTP once we reach the otp step.
  const requestOtp = async (opts: { source: "auto" | "manual" }) => {
    if (!token) return;
    if (opts.source === "auto") {
      if (otpRequestedRef.current) return;
      otpRequestedRef.current = true;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/invitations/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to send verification code.");
        return;
      }
      setOtpSent(true);
      setOtpMessage("Verification code sent by text message. It may take a minute to arrive.");
    } catch {
      setError("Failed to send verification code.");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (step === "otp") requestOtp({ source: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function handleVerify() {
    if (otp.trim().length !== 6) {
      setError("Enter the 6-digit verification code.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/invitations/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, otp: otp.trim() }),
      });
      const data = (await res.json()) as VerifyOtpResponse & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Invalid verification code.");
        return;
      }
      persistInviteSession(data);
      setVerified(true);
    } catch {
      setError("Failed to verify code.");
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Clinic-branded banner, keyed by slug — drop a /public/clinic-headers/<slug>.jpg
  // to brand a clinic's interview page. Hides itself if the clinic has no banner.
  const banner = (
    <div className="w-full max-w-2xl mx-auto mb-5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/clinic-headers/${clinicSlug}.jpg`}
        alt={clinicName ? `${clinicName} header` : "Clinic header"}
        className="w-full h-auto rounded-xl"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
    </div>
  );

  const header = (
    <div className="text-center mb-6">
      <Image
        src="/LogoFinal.png"
        alt="Health Assist AI logo"
        width={240}
        height={56}
        className="mx-auto mb-4 h-[52px] w-[160px] object-contain"
        priority
      />
      {clinicName && <p className="font-semibold text-slate-900">{clinicName}</p>}
      {physicianName && <p className="text-sm text-slate-500">{physicianName}</p>}
    </div>
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-100 flex items-center justify-center">
        <p className="text-slate-500">Loading…</p>
      </main>
    );
  }

  if (verified) {
    return (
      <main className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
        <p className="text-slate-600">Verification successful. Starting your interview…</p>
      </main>
    );
  }

  if (step === "unavailable") {
    return (
      <main className="min-h-screen bg-slate-100 py-10 px-4">
        {banner}
        <div className="w-full max-w-md mx-auto rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          {header}
          <p className="text-slate-700">
            The AI guided interview isn’t available for this clinic right now. Please contact the
            clinic directly.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 py-10 px-4">
      {banner}
      <div className="w-full max-w-lg mx-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {header}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm mb-4">
            {error}
          </div>
        )}

        {/* Step 1: identity */}
        {step === "identity" && (
          <>
            <h1 className="text-xl font-semibold text-slate-900 mb-1">AI Guided Interview</h1>
            <p className="text-sm text-slate-500 mb-5">
              Answer a few questions before your visit. Start by confirming who you are — we’ll text
              you a verification code.
            </p>
            <form onSubmit={handleStart} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">First name *</label>
                  <input
                    required type="text" value={identity.firstName}
                    onChange={(e) => setId("firstName", e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Last name *</label>
                  <input
                    required type="text" value={identity.lastName}
                    onChange={(e) => setId("lastName", e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date of birth *</label>
                <input
                  required type="date" value={identity.dateOfBirth}
                  onChange={(e) => setId("dateOfBirth", e.target.value)}
                  max={new Date().toISOString().substring(0, 10)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email address *</label>
                <input
                  required type="email" value={identity.email}
                  onChange={(e) => setId("email", e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Mobile phone *</label>
                <input
                  required type="tel" value={identity.phone}
                  onChange={(e) => setId("phone", e.target.value)}
                  placeholder="e.g., 555-555-5555"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
                <p className="text-xs text-slate-400 mt-1">
                  We’ll send a one-time verification code to this number by SMS.
                </p>
              </div>
              <button
                type="submit" disabled={submitting}
                className="w-full bg-slate-900 text-white py-3 rounded-lg font-semibold hover:bg-slate-800 disabled:opacity-50 transition"
              >
                {submitting ? "Checking your record…" : "Continue"}
              </button>
            </form>
          </>
        )}

        {/* Step 2: demographics (new patients) */}
        {step === "demographics" && (
          <>
            <h1 className="text-xl font-semibold text-slate-900 mb-1">A few more details</h1>
            <p className="text-sm text-slate-500 mb-5">
              We couldn’t find an existing record for {identity.firstName} {identity.lastName}. Please
              provide a few details to complete your profile.
            </p>
            <form onSubmit={handleDemographics} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Gender *</label>
                <select
                  required value={demographics.gender}
                  onChange={(e) => setDemo("gender", e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                >
                  <option value="" disabled>Select…</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="O">Other</option>
                  <option value="U">Prefer not to say</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Home address *</label>
                <input
                  required type="text" placeholder="Street address" value={demographics.address}
                  onChange={(e) => setDemo("address", e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">City *</label>
                  <input
                    required type="text" value={demographics.city}
                    onChange={(e) => setDemo("city", e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Postal code *</label>
                  <input
                    required type="text" value={demographics.postal}
                    onChange={(e) => setDemo("postal", e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Province *</label>
                <select
                  required value={demographics.province}
                  onChange={(e) => setDemo("province", e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                >
                  {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Coverage type *</label>
                <div className="space-y-2">
                  {COVERAGE_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="radio" name="coverageType" value={opt.value}
                        checked={demographics.coverageType === opt.value}
                        onChange={() => setDemo("coverageType", opt.value)}
                        className="accent-slate-700"
                      />
                      <span className="text-sm text-slate-700">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              {demographics.coverageType === "CANADIAN_HEALTH_CARD" && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Health card number (PHN) (optional)
                  </label>
                  <input
                    type="text" value={demographics.healthCardNumber}
                    onChange={(e) => setDemo("healthCardNumber", e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
              )}
              <button
                type="submit" disabled={submitting}
                className="w-full bg-slate-900 text-white py-3 rounded-lg font-semibold hover:bg-slate-800 disabled:opacity-50 transition"
              >
                {submitting ? "Saving…" : "Continue"}
              </button>
            </form>
          </>
        )}

        {/* Step 3: OTP */}
        {step === "otp" && (
          <>
            <h1 className="text-xl font-semibold text-slate-900 mb-1">Verify your phone</h1>
            <p className="text-sm text-slate-500 mb-5">
              We sent a 6-digit code by text message to {maskedPhone || "your phone"}.
            </p>
            <div className="space-y-3">
              <label htmlFor="otp" className="text-sm font-medium text-slate-800">One-time code</label>
              <input
                id="otp" type="text" inputMode="numeric" maxLength={6} value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-slate-500"
              />
            </div>
            {otpMessage && <p className="mt-3 text-sm text-emerald-700">{otpMessage}</p>}
            <button
              type="button" onClick={handleVerify} disabled={submitting}
              className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {submitting ? "Verifying…" : "Verify and start interview"}
            </button>
            <button
              type="button" onClick={() => requestOtp({ source: "manual" })} disabled={submitting}
              className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {otpSent ? "Resend code" : "Send code"}
            </button>
          </>
        )}

        {/* Blocked */}
        {step === "blocked" && (
          <>
            <div className="bg-red-50 border border-red-200 rounded-xl p-5 space-y-3">
              <p className="text-red-800 font-medium">{blockMessage}</p>
              {blockClinicEmail && (
                <p className="text-sm text-red-700">
                  Contact the clinic:{" "}
                  <a href={`mailto:${blockClinicEmail}`} className="underline">{blockClinicEmail}</a>
                </p>
              )}
            </div>
            <button
              onClick={() => { setStep("identity"); setError(null); }}
              className="mt-4 text-slate-600 text-sm"
            >
              ← Try different information
            </button>
          </>
        )}
      </div>
    </main>
  );
}
