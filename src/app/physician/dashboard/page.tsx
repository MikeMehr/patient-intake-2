"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PatientSession } from "@/lib/session-store";

type PatientSessionWithChartLink = PatientSession & { patientId?: string | null };

const isUuid = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const v = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
};

export default function PhysicianDashboard() {
  const router = useRouter();
  const [sessions, setSessions] = useState<PatientSessionWithChartLink[]>([]);
  type Invitation = {
    id: string;
    patientName: string;
    patientEmail: string;
    sentAt: string | null;
  };
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [invitationsError, setInvitationsError] = useState<string | null>(null);
  const [deletingInvitationId, setDeletingInvitationId] = useState<string | null>(null);
  const [physician, setPhysician] = useState<{
    firstName: string;
    lastName: string;
    clinicName: string;
    clinicAddress?: string | null;
    slug: string | null;
  } | null>(null);
  const [invitePatientName, setInvitePatientName] = useState("");
  const [invitePatientDob, setInvitePatientDob] = useState("");
  const [invitePatientEmail, setInvitePatientEmail] = useState("");
  const [invitePatientBackground, setInvitePatientBackground] = useState("");
  const [invitePrimaryPhone, setInvitePrimaryPhone] = useState("");
  const [inviteSecondaryPhone, setInviteSecondaryPhone] = useState("");
  const [inviteInsuranceNumber, setInviteInsuranceNumber] = useState("");
  const [invitePatientAddress, setInvitePatientAddress] = useState("");
  const [inviteOscarDemographicNo, setInviteOscarDemographicNo] = useState<string>("");
  const [emrLookupLoading, setEmrLookupLoading] = useState(false);
  const [emrMatches, setEmrMatches] = useState<
    Array<{ demographicNo: string; displayName: string; dateOfBirth?: string }>
  >([]);
  const [labReportFile, setLabReportFile] = useState<File | null>(null);
  const [previousLabReportFile, setPreviousLabReportFile] = useState<File | null>(null);
  const [formFile, setFormFile] = useState<File | null>(null);
  const [analyzingLabReport, setAnalyzingLabReport] = useState(false);
  const [labReportSummary, setLabReportSummary] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [invitationLink, setInvitationLink] = useState<string | null>(null);
  const [invitedPatientName, setInvitedPatientName] = useState<string>("");

  type PatientSearchResult = {
    id: string;
    fullName: string;
    dateOfBirth: string | null;
    email: string | null;
    primaryPhone: string | null;
    secondaryPhone: string | null;
    oscarDemographicNo: string | null;
  };
  const [patientLookupName, setPatientLookupName] = useState("");
  const [patientLookupDob, setPatientLookupDob] = useState("");
  const [patientLookupHin, setPatientLookupHin] = useState("");
  const [patientLookupLoading, setPatientLookupLoading] = useState(false);
  const [patientLookupError, setPatientLookupError] = useState<string | null>(null);
  const [patientLookupResults, setPatientLookupResults] = useState<PatientSearchResult[]>([]);

  useEffect(() => {
    // Fetch sessions
    fetch("/api/sessions/list")
      .then((res) => {
        if (res.status === 401) {
          router.push("/auth/login");
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data) {
          if (data.error) {
            setError(data.error);
          } else {
            setSessions(data.sessions || []);
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("Error fetching sessions:", err);
        setError("Failed to load sessions");
        setLoading(false);
      });

    // Fetch physician info (from session cookie)
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.physician) {
          setPhysician({
            firstName: data.physician.firstName,
            lastName: data.physician.lastName,
            clinicName: data.physician.clinicName,
            clinicAddress: data.physician.clinicAddress ?? null,
            slug: data.physician.slug || null,
          });
        }
      })
      .catch(() => {
        // Ignore errors
      });

    // Fetch invitations
    const fetchInvitations = async () => {
      setInvitationsLoading(true);
      setInvitationsError(null);
      try {
        const res = await fetch("/api/invitations/list");
        if (res.status === 401) {
          router.push("/auth/login");
          return;
        }
        const data = await res.json();
        if (!res.ok || data?.error) {
          setInvitationsError(data?.error || "Failed to load invitations");
          setInvitations([]);
        } else {
          const mapped =
            data.invitations?.map((inv: any) => ({
              id: inv.id,
              patientName: inv.patientName,
              patientEmail: inv.patientEmail,
              sentAt: inv.sentAt ?? null,
            })) || [];
          setInvitations(mapped);
        }
      } catch (err) {
        console.error("Error fetching invitations:", err);
        setInvitationsError("Failed to load invitations");
      } finally {
        setInvitationsLoading(false);
      }
    };

    fetchInvitations();
  }, [router]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/auth/login");
  };

  const handleViewSession = (sessionCode: string) => {
    router.push(`/physician/view?code=${sessionCode}`);
  };

  const handleOpenPatientChart = (patientId: string) => {
    if (!isUuid(patientId)) {
      setPatientLookupError("Patient chart is not linked yet (missing patientId).");
      return;
    }
    router.push(`/physician/patients/${encodeURIComponent(patientId)}`);
  };

  const handlePatientLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setPatientLookupError(null);
    setPatientLookupResults([]);

    const name = patientLookupName.trim();
    const dob = patientLookupDob.trim();
    const hin = patientLookupHin.trim();

    if (!hin && !name) {
      setPatientLookupError("Enter at least a Name (or HIN).");
      return;
    }
    if (!hin && name.length < 3) {
      setPatientLookupError("Enter at least 3 characters of the Name (or use HIN).");
      return;
    }

    setPatientLookupLoading(true);
    try {
      const res = await fetch("/api/patients/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || undefined,
          dob: dob || undefined,
          hin: hin || undefined,
          limit: 15,
        }),
      });
      if (res.status === 401) {
        router.push("/auth/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPatientLookupError(data?.error || "Patient lookup failed");
        return;
      }
      setPatientLookupResults(Array.isArray(data?.patients) ? data.patients : []);
    } catch (err) {
      console.error("Patient lookup error:", err);
      setPatientLookupError("Patient lookup failed");
    } finally {
      setPatientLookupLoading(false);
    }
  };

  const handleSendInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    setInviteSuccess(null);
    setInvitationLink(null);
    setLabReportSummary(null);
    setInviteLoading(true);

    try {
      // Create FormData for file upload support
      const formData = new FormData();
      formData.append("patientName", invitePatientName);
      formData.append("patientEmail", invitePatientEmail);
      if (invitePatientBackground.trim()) {
        formData.append("patientBackground", invitePatientBackground.trim());
      }
      if (invitePatientDob.trim()) {
        formData.append("patientDob", invitePatientDob.trim());
      }
      if (invitePrimaryPhone.trim()) {
        formData.append("primaryPhone", invitePrimaryPhone.trim());
      }
      if (inviteSecondaryPhone.trim()) {
        formData.append("secondaryPhone", inviteSecondaryPhone.trim());
      }
      if (inviteInsuranceNumber.trim()) {
        formData.append("insuranceNumber", inviteInsuranceNumber.trim());
      }
      if (invitePatientAddress.trim()) {
        formData.append("patientAddress", invitePatientAddress.trim());
      }
      if (inviteOscarDemographicNo.trim()) {
        formData.append("oscarDemographicNo", inviteOscarDemographicNo.trim());
      }
      if (labReportFile) {
        formData.append("labReport", labReportFile);
      }
      if (previousLabReportFile) {
        formData.append("previousLabReport", previousLabReportFile);
      }
      if (formFile) {
        formData.append("form", formFile);
      }

      const response = await fetch("/api/invitations/send", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        setInviteError(data.error || "Failed to send invitation");
        setInviteLoading(false);
        return;
      }

      setInviteSuccess(data.message || "Invitation sent successfully!");
      if (data.invitationLink) {
        setInvitationLink(data.invitationLink);
        setInvitedPatientName(invitePatientName);
      }
      if (data.labReportSummary) {
        setLabReportSummary(data.labReportSummary);
      }
      setInvitePatientName("");
      setInvitePatientDob("");
      setInvitePatientEmail("");
      setInvitePatientBackground("");
      setInvitePrimaryPhone("");
      setInviteSecondaryPhone("");
      setInviteInsuranceNumber("");
      setInvitePatientAddress("");
      setInviteOscarDemographicNo("");
      setEmrMatches([]);
      setLabReportFile(null);
      setPreviousLabReportFile(null);
      setFormFile(null);
      // Refresh invitations list after sending
      try {
        const res = await fetch("/api/invitations/list");
        if (res.ok) {
          const data = await res.json();
          const mapped =
            data.invitations?.map((inv: any) => ({
              id: inv.id,
              patientName: inv.patientName,
              patientEmail: inv.patientEmail,
              sentAt: inv.sentAt ?? null,
            })) || [];
          setInvitations(mapped);
        }
      } catch {
        // Ignore errors here
      }
      setInviteLoading(false);

      // Refresh sessions after a short delay if email was sent
      if (!data.invitationLink) {
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      }
    } catch (err) {
      setInviteError("An error occurred. Please try again.");
      setInviteLoading(false);
    }
  };

  const handleFetchFromEmr = async () => {
    setInviteError(null);
    setInviteSuccess(null);
    setEmrMatches([]);

    if (!invitePatientName.trim()) {
      setInviteError("Enter patient name before fetching from EMR.");
      return;
    }
    if (!invitePatientDob.trim()) {
      setInviteError("Enter patient date of birth (YYYY-MM-DD) before fetching from EMR.");
      return;
    }

    setEmrLookupLoading(true);
    try {
      const res = await fetch("/api/emr/oscar/patient-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientName: invitePatientName.trim(),
          patientDob: invitePatientDob.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteError(data?.error || "Failed to fetch patient from EMR");
        return;
      }
      const matches = Array.isArray(data?.matches) ? data.matches : [];
      if (matches.length === 0) {
        setInviteError("No matching patients found in OSCAR for that name + DOB.");
        return;
      }
      setEmrMatches(matches);
    } catch (err) {
      console.error("EMR lookup error:", err);
      setInviteError("Failed to fetch patient from EMR");
    } finally {
      setEmrLookupLoading(false);
    }
  };

  const handleSelectEmrMatch = async (demographicNo: string) => {
    setInviteError(null);
    setInviteSuccess(null);
    setEmrLookupLoading(true);
    try {
      const res = await fetch("/api/emr/oscar/patient-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demographicNo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteError(data?.error || "Failed to fetch patient details from EMR");
        return;
      }
      setInviteOscarDemographicNo(String(data?.demographicNo || demographicNo));
      if ((typeof data?.firstName === "string" && data.firstName.trim()) || (typeof data?.lastName === "string" && data.lastName.trim())) {
        const fullName = `${String(data?.firstName || "").trim()} ${String(data?.lastName || "").trim()}`.trim();
        if (fullName) setInvitePatientName(fullName);
      }
      if (typeof data?.dateOfBirth === "string" && data.dateOfBirth.trim()) {
        // Normalize to YYYY-MM-DD if it already is, otherwise keep as-is.
        setInvitePatientDob(data.dateOfBirth.trim());
      }
      if (
        (!invitePatientEmail.trim() || !invitePatientEmail.includes("@")) &&
        typeof data?.patientEmail === "string" &&
        data.patientEmail.trim()
      ) {
        setInvitePatientEmail(data.patientEmail.trim());
      }
      if (typeof data?.primaryPhone === "string") setInvitePrimaryPhone(data.primaryPhone);
      if (typeof data?.secondaryPhone === "string") setInviteSecondaryPhone(data.secondaryPhone);
      if (typeof data?.insuranceNumber === "string") setInviteInsuranceNumber(data.insuranceNumber);
      if (typeof data?.patientAddress === "string") setInvitePatientAddress(data.patientAddress);
      setEmrMatches([]);
      setInviteSuccess("Patient details loaded from OSCAR. Review and send the invitation.");
    } catch (err) {
      console.error("EMR details error:", err);
      setInviteError("Failed to fetch patient details from EMR");
    } finally {
      setEmrLookupLoading(false);
    }
  };

  const handleLabReportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        setInviteError("Invalid file type. Only PDF files are supported.");
        return;
      }
      // Validate file size (max 10MB)
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
      if (file.size > MAX_FILE_SIZE) {
        setInviteError("File size exceeds 10MB limit.");
        return;
      }
      setLabReportFile(file);
      setInviteError(null);
    }
  };

  const handlePreviousLabReportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        setInviteError("Invalid file type for previous lab report. Only PDF files are supported.");
        return;
      }
      // Validate file size (max 10MB)
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
      if (file.size > MAX_FILE_SIZE) {
        setInviteError("Previous lab report file size exceeds 10MB limit.");
        return;
      }
      setPreviousLabReportFile(file);
      setInviteError(null);
    }
  };

  const handleFormFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        setInviteError("Invalid file type for form. Only PDF files are supported.");
        return;
      }
      // Validate file size (max 10MB)
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
      if (file.size > MAX_FILE_SIZE) {
        setInviteError("Form file size exceeds 10MB limit.");
        return;
      }
      setFormFile(file);
      setInviteError(null);
    }
  };

  const handleDeleteInvitation = async (invitationId: string) => {
    setInvitationsError(null);
    setDeletingInvitationId(invitationId);
    const previous = invitations;
    setInvitations((curr) => curr.filter((inv) => inv.id !== invitationId));
    try {
      const res = await fetch(`/api/invitations/${invitationId}`, { method: "DELETE" });
      if (res.status === 401) {
        router.push("/auth/login");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setInvitations(previous);
        setInvitationsError(data.error || "Failed to delete invitation");
      } else {
        setDeletingInvitationId(null);
      }
    } catch (err) {
      console.error("Error deleting invitation:", err);
      setInvitations(previous);
      setInvitationsError("Failed to delete invitation");
    } finally {
      setDeletingInvitationId(null);
    }
  };

  const handleCopyLink = async () => {
    if (invitationLink) {
      try {
        await navigator.clipboard.writeText(invitationLink);
        setInviteSuccess("Link copied to clipboard!");
        setTimeout(() => {
          setInviteSuccess(null);
        }, 2000);
      } catch (err) {
        setInviteError("Failed to copy link");
      }
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-600">Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">
                Patient Intake Dashboard
              </h1>
              {physician && (
                <p className="text-slate-600 mt-1">
                  {physician.firstName} {physician.lastName} - {physician.clinicName}
                  {physician.clinicAddress ? ` • ${physician.clinicAddress}` : ""}
                </p>
              )}
            </div>
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Invite Patient Form */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            Invite Patient
          </h2>
          <form
            onSubmit={handleSendInvitation}
            action="/api/invitations/send"
            method="post"
            encType="multipart/form-data"
            className="space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <label
                  htmlFor="patientName"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Patient Name
                </label>
                <input
                  id="patientName"
                  type="text"
                  value={invitePatientName}
                  onChange={(e) => setInvitePatientName(e.target.value)}
                  required
                  disabled={inviteLoading}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                  placeholder="Enter patient name"
                />

                <div>
                  <label
                    htmlFor="patientDob"
                    className="block text-sm font-medium text-slate-700 mb-1"
                  >
                    Date of birth
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="patientDob"
                      type="date"
                      value={invitePatientDob}
                      onChange={(e) => setInvitePatientDob(e.target.value)}
                      disabled={inviteLoading || emrLookupLoading}
                      className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                    />
                    <button
                      type="button"
                      onClick={handleFetchFromEmr}
                      disabled={inviteLoading || emrLookupLoading}
                      className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {emrLookupLoading ? "Fetching..." : "Fetch from EMR"}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Use name + DOB to find the correct patient in OSCAR.
                  </p>
                </div>
              </div>
              <div>
                <label
                  htmlFor="patientEmail"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Patient Email
                </label>
                <input
                  id="patientEmail"
                  type="email"
                  value={invitePatientEmail}
                  onChange={(e) => setInvitePatientEmail(e.target.value)}
                  required
                  disabled={inviteLoading}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                  placeholder="patient@example.com"
                />
              </div>
            </div>

            {emrMatches.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-800">Select a patient from OSCAR</p>
                <div className="mt-3 space-y-2">
                  {emrMatches.map((m) => (
                    <div
                      key={m.demographicNo}
                      className="flex items-center justify-between gap-3 rounded-lg bg-white border border-slate-200 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 truncate">
                          {m.displayName}
                        </div>
                        <div className="text-xs text-slate-500">
                          DOB: {m.dateOfBirth || invitePatientDob || "—"} • ID: {m.demographicNo}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSelectEmrMatch(m.demographicNo)}
                        disabled={emrLookupLoading}
                        className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        Use this
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Primary phone (Optional)
                </label>
                <input
                  type="tel"
                  value={invitePrimaryPhone}
                  onChange={(e) => setInvitePrimaryPhone(e.target.value)}
                  disabled={inviteLoading}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                  placeholder="e.g., 555-555-5555"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Secondary phone (Optional)
                </label>
                <input
                  type="tel"
                  value={inviteSecondaryPhone}
                  onChange={(e) => setInviteSecondaryPhone(e.target.value)}
                  disabled={inviteLoading}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Health insurance number (Optional)
                </label>
                <input
                  type="text"
                  value={inviteInsuranceNumber}
                  onChange={(e) => setInviteInsuranceNumber(e.target.value)}
                  disabled={inviteLoading}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                  placeholder="HIN"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Patient address (Optional)
                </label>
                <input
                  type="text"
                  value={invitePatientAddress}
                  onChange={(e) => setInvitePatientAddress(e.target.value)}
                  disabled={inviteLoading}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                  placeholder="Street, City, Province, Postal"
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="patientBackground"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Patient background for AI (Optional)
              </label>
              <textarea
                id="patientBackground"
                value={invitePatientBackground}
                onChange={(e) => setInvitePatientBackground(e.target.value)}
                disabled={inviteLoading}
                rows={3}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                placeholder="E.g., follow-up for hypertension; last visit 3 months ago; discuss med adherence and side effects."
              />
              <p className="text-xs text-slate-500 mt-1">
                Optional context to help the AI focus (e.g., prior visit summary, pertinent history).
              </p>
            </div>
            <div>
              <label
                htmlFor="labReport"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Lab Report PDF (Optional)
              </label>
              <input
                id="labReport"
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleLabReportFileChange}
                disabled={inviteLoading}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
              />
              <p className="text-xs text-slate-500 mt-1">
                Upload a lab report PDF to enable AI discussion of results with the patient during intake.
              </p>
              {labReportFile && (
                <p className="text-xs text-green-700 mt-1">
                  Selected: {labReportFile.name} ({(labReportFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="previousLabReport"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Previous Lab Report PDF (Optional)
              </label>
              <input
                id="previousLabReport"
                type="file"
                accept=".pdf,application/pdf"
                onChange={handlePreviousLabReportFileChange}
                disabled={inviteLoading}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
              />
              <p className="text-xs text-slate-500 mt-1">
                Upload a previous lab report PDF for comparison with the current lab report. The AI will discuss trends and changes between the two reports.
              </p>
              {previousLabReportFile && (
                <p className="text-xs text-green-700 mt-1">
                  Selected: {previousLabReportFile.name} ({(previousLabReportFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="form"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Form PDF (Optional)
              </label>
              <input
                id="form"
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleFormFileChange}
                disabled={inviteLoading}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
              />
              <p className="text-xs text-slate-500 mt-1">
                Upload a form (school/work/MVA insurance) that needs to be completed. The AI will ask relevant questions during the interview.
              </p>
              {formFile && (
                <p className="text-xs text-green-700 mt-1">
                  Selected: {formFile.name} ({(formFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>
            {inviteError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-sm text-red-800">{inviteError}</p>
              </div>
            )}
            {inviteSuccess && (
              <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3">
                <p className="text-sm text-green-800">{inviteSuccess}</p>
              </div>
            )}
            {invitationLink && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
                <p className="text-sm font-medium text-blue-900 mb-2">Invitation Link:</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={invitationLink}
                    className="flex-1 rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-100 rounded-lg hover:bg-blue-200 transition-colors"
                  >
                    Copy
                  </button>
                </div>
                <p className="text-xs text-blue-700 mt-2">
                  Share this link with {invitedPatientName || "the patient"} to complete their intake form.
                </p>
              </div>
            )}
            <button
              type="submit"
              disabled={inviteLoading}
              className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {inviteLoading ? "Sending..." : "Send Invitation"}
            </button>
          </form>
        </div>

        {/* Sessions List */}
        {error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">{error}</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-8 text-center">
            <p className="text-slate-600">No patient sessions yet.</p>
            <p className="text-sm text-slate-500 mt-2">
              Invite patients using the form above to get started.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">
                Patient Sessions ({sessions.length})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Patient Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Chief Complaint
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Completed
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {sessions.map((session) => (
                    <tr key={session.sessionCode} className="hover:bg-slate-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">
                        {session.patientName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                        {session.patientEmail}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        <div className="max-w-xs truncate">
                          {session.chiefComplaint}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                        {new Date(session.completedAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {session.viewedByPhysician ? (
                          <span className="px-2 py-1 text-xs font-medium text-green-800 bg-green-100 rounded-full">
                            Viewed
                          </span>
                        ) : (
                          <span className="px-2 py-1 text-xs font-medium text-blue-800 bg-blue-100 rounded-full">
                            New
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {(() => {
                          const pid = session.patientId;
                          return (
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handleViewSession(session.sessionCode)}
                            className="text-blue-600 hover:text-blue-900 font-medium"
                          >
                            View
                          </button>
                          {isUuid(pid) ? (
                            <button
                              type="button"
                              onClick={() => handleOpenPatientChart(pid)}
                              className="text-slate-900 hover:text-slate-700 font-medium"
                            >
                              Open chart
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">Chart pending</span>
                          )}
                        </div>
                          );
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Invitations List */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden mt-6">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">
              Invited Patients {invitations.length ? `(${invitations.length})` : ""}
            </h2>
            {invitationsLoading && (
              <span className="text-sm text-slate-500">Loading...</span>
            )}
          </div>
          {invitationsError && (
            <div className="px-6 py-4 bg-red-50 text-sm text-red-800 border-b border-red-200">
              {invitationsError}
            </div>
          )}
          {invitations.length === 0 && !invitationsLoading ? (
            <div className="px-6 py-6 text-sm text-slate-600">
              No invitations yet. Send an invitation above to see it here.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Patient Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Patient Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Sent At
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {invitations.map((invitation) => (
                    <tr key={invitation.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">
                        {invitation.patientName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                        {invitation.patientEmail}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                        {invitation.sentAt
                          ? new Date(invitation.sentAt).toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <button
                          onClick={() => handleDeleteInvitation(invitation.id)}
                          disabled={deletingInvitationId === invitation.id}
                          className="text-red-600 hover:text-red-800 font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {deletingInvitationId === invitation.id ? "Deleting..." : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Patient Lookup (Chart) */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mt-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Patient Lookup</h2>
          <p className="text-sm text-slate-600 mb-4">
            Search for a patient by Name (recommended: Name + DOB) or by Healthcare Number (HIN).
          </p>

          <form onSubmit={handlePatientLookup} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                <input
                  type="text"
                  value={patientLookupName}
                  onChange={(e) => setPatientLookupName(e.target.value)}
                  disabled={patientLookupLoading}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                  placeholder="First Last"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date of birth</label>
                <input
                  type="date"
                  value={patientLookupDob}
                  onChange={(e) => setPatientLookupDob(e.target.value)}
                  disabled={patientLookupLoading}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Healthcare number (HIN)
                </label>
                <input
                  type="text"
                  value={patientLookupHin}
                  onChange={(e) => setPatientLookupHin(e.target.value)}
                  disabled={patientLookupLoading}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                  placeholder="Optional"
                />
              </div>
            </div>

            {patientLookupError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-sm text-red-800">{patientLookupError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={patientLookupLoading}
              className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {patientLookupLoading ? "Searching..." : "Search"}
            </button>
          </form>

          <div className="mt-5">
            {patientLookupResults.length === 0 ? (
              <p className="text-sm text-slate-600">No results yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Patient
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                        DOB
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Phone
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-200">
                    {patientLookupResults.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-sm font-medium text-slate-900">
                          <div className="min-w-0">
                            <div className="truncate">{p.fullName}</div>
                            <div className="text-xs text-slate-500 truncate">
                              {p.oscarDemographicNo ? `OSCAR: ${p.oscarDemographicNo}` : "OSCAR: —"}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                          {p.dateOfBirth || "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                          {p.primaryPhone || p.secondaryPhone || "—"}
                        </td>
                        <td className="px-4 py-3 text-sm whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleOpenPatientChart(p.id)}
                            className="text-blue-600 hover:text-blue-900 font-medium"
                          >
                            Open chart
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}




