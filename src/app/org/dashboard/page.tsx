"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SessionKeepAlive from "@/components/auth/SessionKeepAlive";
import PasskeyEnrollmentBanner from "@/components/auth/PasskeyEnrollmentBanner";

interface Organization {
  id: string;
  name: string;
  email: string;
  businessAddress: string;
  phone: string | null;
  fax: string | null;
  isActive: boolean;
  slug: string | null;
}

interface Provider {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string | null;
  phone: string | null;
  uniqueSlug: string;
  createdAt: string;
  oscarProviderNo: string | null;
}

interface SyncSummary {
  failed: number;
  skipped: number;
  total: number;
}

interface EmrStatus {
  configured: boolean;
  connected: boolean;
  status: string;
  baseUrl: string | null;
  lastTestedAt: string | null;
}

export default function OrgDashboard() {
  const router = useRouter();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [emrStatus, setEmrStatus] = useState<EmrStatus | null>(null);
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingProviderId, setOpeningProviderId] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      // Fetch organization, providers, EMR status, and OSCAR sync summary in parallel
      const [orgResponse, providersResponse, emrResponse, syncResponse] = await Promise.all([
        fetch("/api/org/organization"),
        fetch("/api/org/providers"),
        fetch("/api/org/emr-status"),
        fetch("/api/org/oscar-sync-summary"),
      ]);

      if (orgResponse.status === 401 || providersResponse.status === 401) {
        router.push("/org/login");
        return;
      }

      const orgData = await orgResponse.json();
      const providersData = await providersResponse.json();

      if (emrResponse.ok) {
        setEmrStatus(await emrResponse.json());
      }

      if (syncResponse.ok) {
        setSyncSummary(await syncResponse.json());
      }

      if (orgData.error) {
        setError(orgData.error);
      } else {
        setOrganization(orgData.organization);
      }

      if (providersData.error) {
        setError(providersData.error);
      } else {
        setProviders(providersData.providers || []);
      }
    } catch (err) {
      console.error("Error fetching data:", err);
      setError("Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/org/login");
      router.refresh();
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  const handleOpenPhysicianDashboard = async (providerId: string) => {
    setOpeningProviderId(providerId);
    try {
      const response = await fetch("/api/org/act-as-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(data.error || "Unable to open the Physician Dashboard");
        setOpeningProviderId(null);
        return;
      }
      // The provider session cookie is now set; go to the Physician Dashboard.
      window.location.href = data.redirectTo || "/physician/dashboard";
    } catch (err) {
      console.error("Error opening physician dashboard:", err);
      alert("Unable to open the Physician Dashboard");
      setOpeningProviderId(null);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    if (!confirm("Are you sure you want to delete this provider?")) {
      return;
    }

    try {
      const response = await fetch(`/api/org/providers/${providerId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || "Failed to delete provider");
        return;
      }

      // Refresh providers list
      fetchData();
    } catch (err) {
      console.error("Error deleting provider:", err);
      alert("Failed to delete provider");
    }
  };

  if (loading) {
    return (
      <>
        <SessionKeepAlive redirectTo="/org/login" />
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-slate-600">Loading...</p>
        </div>
      </>
    );
  }

  return (
    <>
      <SessionKeepAlive redirectTo="/org/login" />
      <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">
                Online Booking Dashboard
              </h1>
              <p className="text-[1.1375rem] text-slate-600 mt-1">
                {organization?.name || "Loading..."}
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <PasskeyEnrollmentBanner />
        {error && (
          <div className="mb-6 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {emrStatus?.connected && syncSummary && syncSummary.total > 0 && (
          <Link
            href="/org/appointments"
            className="mb-6 flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 hover:bg-amber-100 transition"
          >
            <span className="text-xl leading-none">⚠️</span>
            <div className="text-sm">
              <p className="font-semibold text-amber-900">
                {syncSummary.total} upcoming {syncSummary.total === 1 ? "booking" : "bookings"} did not reach OSCAR&apos;s schedule
              </p>
              <p className="text-amber-700 mt-0.5">
                {syncSummary.failed > 0 && `${syncSummary.failed} failed`}
                {syncSummary.failed > 0 && syncSummary.skipped > 0 && ", "}
                {syncSummary.skipped > 0 && `${syncSummary.skipped} skipped`}
                {" "}— these appointments won&apos;t appear on the provider&apos;s OSCAR day sheet. Review and enter them manually if needed →
              </p>
            </div>
          </Link>
        )}

        <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/org/booking-settings"
            className="flex items-center gap-3 bg-white border border-slate-200 rounded-lg px-5 py-4 hover:border-blue-400 hover:shadow-sm transition"
          >
            <span className="text-2xl">📅</span>
            <div>
              <p className="text-sm font-semibold text-slate-900">Online Booking</p>
              <p className="text-xs text-slate-500">Manage booking settings &amp; slots</p>
            </div>
          </Link>
          <Link
            href="/org/slots"
            className="flex items-center gap-3 bg-white border border-slate-200 rounded-lg px-5 py-4 hover:border-blue-400 hover:shadow-sm transition"
          >
            <span className="text-2xl">🕐</span>
            <div>
              <p className="text-sm font-semibold text-slate-900">Appointment Slots</p>
              <p className="text-xs text-slate-500">Add &amp; manage available times</p>
            </div>
          </Link>
          <Link
            href="/org/appointments"
            className="flex items-center gap-3 bg-white border border-slate-200 rounded-lg px-5 py-4 hover:border-blue-400 hover:shadow-sm transition"
          >
            <span className="text-2xl">📋</span>
            <div>
              <p className="text-sm font-semibold text-slate-900">Appointments</p>
              <p className="text-xs text-slate-500">View booked appointments</p>
            </div>
          </Link>
          {organization?.slug && (
            <a
              href={`/booking/${organization.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 bg-white border border-slate-200 rounded-lg px-5 py-4 hover:border-blue-400 hover:shadow-sm transition"
            >
              <span className="text-2xl">🔗</span>
              <div>
                <p className="text-sm font-semibold text-slate-900">Patient Booking Page</p>
                <p className="text-xs text-slate-500">Open your public /booking/{organization.slug} page</p>
              </div>
            </a>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Organization Details</h2>
              {organization ? (
                <dl className="space-y-3">
                  <div>
                    <dt className="text-sm font-medium text-slate-500">Name</dt>
                    <dd className="text-sm text-slate-900 mt-1">{organization.name}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-slate-500">Email</dt>
                    <dd className="text-sm text-slate-900 mt-1">{organization.email}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-slate-500">Address</dt>
                    <dd className="text-sm text-slate-900 mt-1">{organization.businessAddress}</dd>
                  </div>
                  {organization.phone && (
                    <div>
                      <dt className="text-sm font-medium text-slate-500">Phone</dt>
                      <dd className="text-sm text-slate-900 mt-1">{organization.phone}</dd>
                    </div>
                  )}
                  {organization.fax && (
                    <div>
                      <dt className="text-sm font-medium text-slate-500">Fax</dt>
                      <dd className="text-sm text-slate-900 mt-1">{organization.fax}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-sm font-medium text-slate-500">Status</dt>
                    <dd className="mt-1">
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          organization.isActive
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {organization.isActive ? "Active" : "Inactive"}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-slate-500">EMR (OSCAR)</dt>
                    <dd className="mt-1">
                      {(() => {
                        const connected = emrStatus?.connected;
                        const isError = emrStatus?.status === "error";
                        const label = connected
                          ? "Connected"
                          : isError
                            ? "Connection error"
                            : emrStatus?.configured
                              ? "Not connected"
                              : "Not configured";
                        const cls = connected
                          ? "bg-green-100 text-green-800"
                          : isError
                            ? "bg-red-100 text-red-800"
                            : "bg-slate-100 text-slate-700";
                        return (
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${cls}`}
                          >
                            {label}
                          </span>
                        );
                      })()}
                      {!emrStatus?.connected && (
                        <p className="text-xs text-slate-400 mt-1">
                          Managed by your administrator (Guided Interview dashboard).
                        </p>
                      )}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-slate-500">Loading organization details...</p>
              )}
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">
                  Providers ({providers.length})
                </h2>
                <Link
                  href="/org/providers/new"
                  className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition"
                >
                  Add Provider
                </Link>
              </div>
              {providers.length === 0 ? (
                <div className="px-6 py-8 text-center text-sm text-slate-500">
                  No providers yet. Click "Add Provider" to get started.
                </div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {providers.map((provider) => (
                    <div key={provider.id} className="px-6 py-4 hover:bg-slate-50">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium text-slate-900">
                              {provider.firstName} {provider.lastName}
                            </div>
                            {emrStatus?.connected && !provider.oscarProviderNo && (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-medium"
                                title="This provider has no OSCAR provider number, so their online bookings will NOT sync to the OSCAR schedule. Click Edit to add it."
                              >
                                ⚠️ Not synced to OSCAR
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            Username: {provider.username}
                            {provider.email && ` • ${provider.email}`}
                            {provider.phone && ` • ${provider.phone}`}
                          </div>
                          <div className="text-xs text-slate-400 mt-1">
                            Intake Link: {process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}
                            /intake/{provider.uniqueSlug}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleOpenPhysicianDashboard(provider.id)}
                            disabled={openingProviderId === provider.id}
                            title="Open this provider's Physician Dashboard (guided interviews & transcription) without logging in again"
                            className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
                          >
                            {openingProviderId === provider.id ? "Opening…" : "Physician Dashboard"}
                          </button>
                          <span className="text-slate-300">|</span>
                          <Link
                            href={`/org/providers/${provider.id}/edit`}
                            className="text-sm text-slate-600 hover:text-slate-900"
                          >
                            Edit
                          </Link>
                          <button
                            onClick={() => handleDeleteProvider(provider.id)}
                            className="text-sm text-red-600 hover:text-red-900"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      </div>
    </>
  );
}

