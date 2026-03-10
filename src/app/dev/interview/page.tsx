"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DevInterviewLauncherPage() {
  const router = useRouter();
  const [physicianSlug, setPhysicianSlug] = useState("");
  const [patientName, setPatientName] = useState("Dev Test Patient");
  const [patientEmail, setPatientEmail] = useState("dev-test@example.com");
  const [patientDob, setPatientDob] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persistInviteSession = (data: {
    physicianId: string;
    physicianName: string;
    clinicName: string;
    organizationWebsiteUrl?: string | null;
    patientName: string;
    patientEmail: string;
    patientDob: string | null;
  }) => {
    if (typeof window === "undefined") return;
    sessionStorage.setItem("physicianId", data.physicianId);
    sessionStorage.setItem("physicianName", data.physicianName);
    sessionStorage.setItem("clinicName", data.clinicName);
    sessionStorage.setItem("invitedFlow", "true");
    sessionStorage.setItem("invitePatientName", data.patientName);
    sessionStorage.setItem("invitePatientEmail", data.patientEmail);
    sessionStorage.setItem("invitePatientDob", data.patientDob || "");
    sessionStorage.setItem("organizationWebsiteUrl", data.organizationWebsiteUrl || "");
  };

  const handleLaunch = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          physicianSlug: physicianSlug.trim() || undefined,
          patientName: patientName.trim() || undefined,
          patientEmail: patientEmail.trim() || undefined,
          patientDob: patientDob.trim() || undefined,
        }),
      });

      const data = (await res.json()) as {
        physicianId?: string;
        physicianName?: string;
        clinicName?: string;
        patientName?: string;
        patientEmail?: string;
        patientDob?: string | null;
        organizationWebsiteUrl?: string | null;
        error?: string;
      };

      if (!res.ok) {
        setError(data.error || "Failed to create dev session");
        return;
      }

      persistInviteSession({
        physicianId: data.physicianId!,
        physicianName: data.physicianName!,
        clinicName: data.clinicName!,
        organizationWebsiteUrl: data.organizationWebsiteUrl ?? null,
        patientName: data.patientName!,
        patientEmail: data.patientEmail!,
        patientDob: data.patientDob ?? null,
      });

      router.replace("/");
    } catch {
      setError("Failed to create dev session");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Dev Interview Harness</h1>
        <p className="mt-2 text-sm text-slate-600">
          Launch a guided interview without invitation or OTP. Requires{" "}
          <code className="rounded bg-slate-200 px-1">ENABLE_DEV_INTERVIEW_HARNESS=true</code>{" "}
          in .env.local.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="physicianSlug" className="text-sm font-medium text-slate-800">
              Physician slug (optional)
            </label>
            <input
              id="physicianSlug"
              type="text"
              value={physicianSlug}
              onChange={(e) => setPhysicianSlug(e.target.value)}
              placeholder="e.g. dr-smith"
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 outline-none focus:border-slate-500"
            />
            <p className="mt-0.5 text-xs text-slate-500">Leave empty to use first physician</p>
          </div>

          <div>
            <label htmlFor="patientName" className="text-sm font-medium text-slate-800">
              Patient name
            </label>
            <input
              id="patientName"
              type="text"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 outline-none focus:border-slate-500"
            />
          </div>

          <div>
            <label htmlFor="patientEmail" className="text-sm font-medium text-slate-800">
              Patient email
            </label>
            <input
              id="patientEmail"
              type="email"
              value={patientEmail}
              onChange={(e) => setPatientEmail(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 outline-none focus:border-slate-500"
            />
          </div>

          <div>
            <label htmlFor="patientDob" className="text-sm font-medium text-slate-800">
              Patient DOB (optional, YYYY-MM-DD)
            </label>
            <input
              id="patientDob"
              type="text"
              value={patientDob}
              onChange={(e) => setPatientDob(e.target.value)}
              placeholder="1990-01-01"
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 outline-none focus:border-slate-500"
            />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <button
          type="button"
          onClick={handleLaunch}
          disabled={loading}
          className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Creating session..." : "Launch guided interview"}
        </button>
      </div>
    </div>
  );
}
