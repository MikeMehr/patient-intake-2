"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";

const IntakeForm = dynamic(() => import("@/app/page"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <p className="text-slate-600">Loading intake form...</p>
    </div>
  ),
});

type OpenInvitationResponse = {
  invitationId: string;
  physicianName: string;
  clinicName: string;
  patientName: string;
  maskedEmail: string;
  tokenExpiresAt: string | null;
};

type VerifyOtpResponse = {
  success: boolean;
  patientName: string;
  patientEmail: string;
  physicianId: string;
  physicianName: string;
  clinicName: string;
};

export default function InvitationTokenIntakePage() {
  const params = useParams();
  const token = useMemo(() => String(params.token || ""), [params.token]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [openInfo, setOpenInfo] = useState<OpenInvitationResponse | null>(null);
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpMessage, setOtpMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);

  const requestOtp = async () => {
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/invitations/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Failed to send OTP.");
        return;
      }
      setOtpSent(true);
      setOtpMessage("Verification code sent to your email.");
    } catch {
      setError("Failed to send OTP.");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/invitations/open/${encodeURIComponent(token)}`);
        const data = await response.json();
        if (!response.ok) {
          setError(data.error || "Invitation is not valid.");
          setLoading(false);
          return;
        }
        setOpenInfo(data);
        await requestOtp();
      } catch {
        setError("Failed to open invitation.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const handleVerify = async () => {
    if (otp.trim().length !== 6) {
      setError("Enter the 6-digit verification code.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/invitations/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, otp: otp.trim() }),
      });
      const data = (await response.json()) as VerifyOtpResponse & { error?: string };
      if (!response.ok) {
        setError(data.error || "Invalid verification code.");
        return;
      }

      if (typeof window !== "undefined") {
        sessionStorage.setItem("physicianId", data.physicianId);
        sessionStorage.setItem("physicianName", data.physicianName);
        sessionStorage.setItem("clinicName", data.clinicName);
        sessionStorage.setItem("invitedFlow", "true");
        sessionStorage.setItem("invitePatientName", data.patientName);
        sessionStorage.setItem("invitePatientEmail", data.patientEmail);
      }
      setVerified(true);
    } catch {
      setError("Failed to verify OTP.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-600">Loading invitation...</p>
      </div>
    );
  }

  if (verified) {
    return (
      <div className="min-h-screen bg-slate-100">
        <div className="border-b border-slate-200 bg-white px-4 py-4">
          <div className="mx-auto max-w-7xl">
            <h1 className="text-xl font-semibold text-slate-900">
              {openInfo?.physicianName || "Invited intake"}
            </h1>
            <p className="text-sm text-slate-600">{openInfo?.clinicName || ""}</p>
          </div>
        </div>
        <IntakeForm />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Verify your invitation</h1>
        <p className="mt-2 text-sm text-slate-600">
          {openInfo
            ? `We sent a 6-digit code to ${openInfo.maskedEmail}.`
            : "Enter your verification code."}
        </p>

        <div className="mt-4 space-y-3">
          <label htmlFor="otp" className="text-sm font-medium text-slate-800">
            One-time code
          </label>
          <input
            id="otp"
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={otp}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
            placeholder="123456"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-slate-500"
          />
        </div>

        {otpMessage && <p className="mt-3 text-sm text-emerald-700">{otpMessage}</p>}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <button
          type="button"
          onClick={handleVerify}
          disabled={submitting}
          className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Verifying..." : "Verify and continue"}
        </button>

        <button
          type="button"
          onClick={requestOtp}
          disabled={submitting}
          className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {otpSent ? "Resend code" : "Send code"}
        </button>
      </div>
    </div>
  );
}
