"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";

interface Organization {
  id: string;
  name: string;
  email: string;
  businessAddress: string;
  phone: string | null;
  fax: string | null;
  websiteUrl: string | null;
  isActive: boolean;
  createdAt: string;
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
}

export default function OrganizationDetailPage() {
  const router = useRouter();
  const params = useParams();
  const organizationId = params.id as string;

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orgForm, setOrgForm] = useState({
    name: "",
    email: "",
    businessAddress: "",
    phone: "",
    fax: "",
    websiteUrl: "",
    isActive: true,
  });
  const [savingOrg, setSavingOrg] = useState(false);
  const [orgSaveError, setOrgSaveError] = useState<string | null>(null);
  const [orgSaveSuccess, setOrgSaveSuccess] = useState<string | null>(null);

  const [oscarLoading, setOscarLoading] = useState(false);
  const [oscarError, setOscarError] = useState<string | null>(null);
  const [oscarStatus, setOscarStatus] = useState<string>("not_connected");
  const [oscarBaseUrl, setOscarBaseUrl] = useState<string>("");
  const [oscarClientKey, setOscarClientKey] = useState<string>("");
  const [oscarClientSecret, setOscarClientSecret] = useState<string>("");
  const [oscarClientSecretMasked, setOscarClientSecretMasked] = useState<string | null>(null);
  const [oscarLastTestedAt, setOscarLastTestedAt] = useState<string | null>(null);
  const [appOrigin, setAppOrigin] = useState<string>("");

  useEffect(() => {
    if (organizationId) {
      fetchOrganizationDetails();
      fetchOscarConfig();
    }
  }, [organizationId]);

  useEffect(() => {
    // For display only; env vars are inlined at build time, so `window.location.origin`
    // is the most accurate value in production (custom domain vs azurewebsites.net).
    if (typeof window !== "undefined") setAppOrigin(window.location.origin);
  }, []);

  const fetchOscarConfig = async () => {
    setOscarError(null);
    setOscarLoading(true);
    try {
      const response = await fetch(`/api/admin/organizations/${organizationId}/emr/oscar`);
      if (response.status === 401) {
        router.push("/admin/login");
        return;
      }
      const data = await response.json();
      if (!response.ok || data?.error) {
        setOscarError(data?.error || "Failed to load OSCAR configuration");
        return;
      }
      setOscarStatus(data?.status || "not_connected");
      setOscarBaseUrl(data?.baseUrl || "");
      setOscarClientKey(data?.clientKey || "");
      setOscarClientSecretMasked(data?.clientSecretMasked || null);
      setOscarLastTestedAt(data?.lastTestedAt || null);
    } catch (err) {
      console.error("Error fetching OSCAR config:", err);
      setOscarError("Failed to load OSCAR configuration");
    } finally {
      setOscarLoading(false);
    }
  };

  const saveOscarConfig = async () => {
    setOscarError(null);
    setOscarLoading(true);
    try {
      const response = await fetch(`/api/admin/organizations/${organizationId}/emr/oscar`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: oscarBaseUrl,
          clientKey: oscarClientKey,
          clientSecret: oscarClientSecret,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setOscarError(data?.error || "Failed to save OSCAR configuration");
        return;
      }
      setOscarClientSecret("");
      await fetchOscarConfig();
    } catch (err) {
      console.error("Error saving OSCAR config:", err);
      setOscarError("Failed to save OSCAR configuration");
    } finally {
      setOscarLoading(false);
    }
  };

  const connectOscar = async () => {
    setOscarError(null);
    setOscarLoading(true);
    try {
      const response = await fetch(`/api/admin/organizations/${organizationId}/emr/oscar/connect`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setOscarError(data?.error || "Failed to start OSCAR connect");
        return;
      }
      if (data?.authorizeUrl) {
        window.location.href = data.authorizeUrl;
      } else {
        setOscarError("OSCAR connect did not return an authorize URL");
      }
    } catch (err) {
      console.error("Error connecting OSCAR:", err);
      setOscarError("Failed to start OSCAR connect");
    } finally {
      setOscarLoading(false);
    }
  };

  const testOscar = async () => {
    setOscarError(null);
    setOscarLoading(true);
    try {
      const response = await fetch(`/api/admin/organizations/${organizationId}/emr/oscar/test`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setOscarError(data?.error || "OSCAR test failed");
        return;
      }
      await fetchOscarConfig();
    } catch (err) {
      console.error("Error testing OSCAR:", err);
      setOscarError("OSCAR test failed");
    } finally {
      setOscarLoading(false);
    }
  };

  const disconnectOscar = async () => {
    if (!confirm("Disconnect OSCAR for this organization?")) return;
    setOscarError(null);
    setOscarLoading(true);
    try {
      const response = await fetch(`/api/admin/organizations/${organizationId}/emr/oscar/disconnect`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setOscarError(data?.error || "Failed to disconnect OSCAR");
        return;
      }
      await fetchOscarConfig();
    } catch (err) {
      console.error("Error disconnecting OSCAR:", err);
      setOscarError("Failed to disconnect OSCAR");
    } finally {
      setOscarLoading(false);
    }
  };

  const fetchOrganizationDetails = async () => {
    try {
      const response = await fetch(`/api/admin/organizations/${organizationId}`);
      if (response.status === 401) {
        router.push("/admin/login");
        return;
      }
      const data = await response.json();
      if (data.error) {
        setError(data.error);
      } else {
        setOrganization(data.organization);
        setOrgForm({
          name: data.organization?.name || "",
          email: data.organization?.email || "",
          businessAddress: data.organization?.businessAddress || "",
          phone: data.organization?.phone || "",
          fax: data.organization?.fax || "",
          websiteUrl: data.organization?.websiteUrl || "",
          isActive: Boolean(data.organization?.isActive),
        });
        setProviders(data.providers || []);
      }
    } catch (err) {
      console.error("Error fetching organization:", err);
      setError("Failed to load organization details");
    } finally {
      setLoading(false);
    }
  };

  const saveOrganizationDetails = async () => {
    if (!organization) return;
    setOrgSaveError(null);
    setOrgSaveSuccess(null);
    setSavingOrg(true);
    try {
      const response = await fetch(`/api/admin/organizations/${organizationId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: orgForm.name,
          email: orgForm.email,
          businessAddress: orgForm.businessAddress,
          phone: orgForm.phone.trim() || null,
          fax: orgForm.fax.trim() || null,
          isActive: orgForm.isActive,
          websiteUrl: orgForm.websiteUrl.trim() || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setOrgSaveError(data?.error || "Failed to update organization details.");
        return;
      }
      setOrgSaveSuccess("Organization details updated.");
      await fetchOrganizationDetails();
    } catch (err) {
      console.error("Error updating organization details:", err);
      setOrgSaveError("Failed to update organization details.");
    } finally {
      setSavingOrg(false);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    if (!confirm("Are you sure you want to delete this provider?")) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/providers/${providerId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || "Failed to delete provider");
        return;
      }

      // Refresh providers list
      fetchOrganizationDetails();
    } catch (err) {
      console.error("Error deleting provider:", err);
      alert("Failed to delete provider");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-slate-600">Loading...</p>
      </div>
    );
  }

  if (error || !organization) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || "Organization not found"}</p>
          <Link
            href="/admin/dashboard"
            className="text-sm text-slate-600 hover:text-slate-900 underline"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <Link
                href="/admin/dashboard"
                className="text-sm text-slate-600 hover:text-slate-900 mb-2 inline-block"
              >
                ← Back to Dashboard
              </Link>
              <h1 className="text-2xl font-semibold text-slate-900">{organization.name}</h1>
            </div>
            <Link
              href={`/admin/organizations/${organizationId}/providers/new`}
              className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition"
            >
              Add Provider
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Organization Details</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-500">Name</label>
                  <input
                    type="text"
                    value={orgForm.name}
                    onChange={(e) =>
                      setOrgForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    disabled={savingOrg}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-500">Email</label>
                  <input
                    type="email"
                    value={orgForm.email}
                    onChange={(e) =>
                      setOrgForm((prev) => ({ ...prev, email: e.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    disabled={savingOrg}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-500">Address</label>
                  <textarea
                    value={orgForm.businessAddress}
                    onChange={(e) =>
                      setOrgForm((prev) => ({ ...prev, businessAddress: e.target.value }))
                    }
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    disabled={savingOrg}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-500">Phone</label>
                  <input
                    type="tel"
                    value={orgForm.phone}
                    onChange={(e) =>
                      setOrgForm((prev) => ({ ...prev, phone: e.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    disabled={savingOrg}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Fax
                  </label>
                  <input
                    type="text"
                    value={orgForm.fax}
                    onChange={(e) =>
                      setOrgForm((prev) => ({ ...prev, fax: e.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    disabled={savingOrg}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Organization Website
                  </label>
                  <input
                    type="url"
                    value={orgForm.websiteUrl}
                    onChange={(e) =>
                      setOrgForm((prev) => ({ ...prev, websiteUrl: e.target.value }))
                    }
                    placeholder="https://www.exampleclinic.org"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    disabled={savingOrg}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Patients are redirected here after completing intake. Leave blank to use platform default.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                  <select
                    value={orgForm.isActive ? "active" : "inactive"}
                    onChange={(e) =>
                      setOrgForm((prev) => ({
                        ...prev,
                        isActive: e.target.value === "active",
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    disabled={savingOrg}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="mt-5 pt-5 border-t border-slate-200 space-y-3">
                {orgSaveError && <p className="text-xs text-red-700">{orgSaveError}</p>}
                {orgSaveSuccess && <p className="text-xs text-emerald-700">{orgSaveSuccess}</p>}
                <button
                  type="button"
                  onClick={saveOrganizationDetails}
                  disabled={savingOrg}
                  className="px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {savingOrg ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 mt-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">EMR (OSCAR)</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Store credentials per organization. Tokens are stored encrypted.
                  </p>
                </div>
                <span
                  className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    oscarStatus === "connected"
                      ? "bg-green-100 text-green-800"
                      : oscarStatus === "error"
                        ? "bg-red-100 text-red-800"
                        : "bg-slate-100 text-slate-800"
                  }`}
                >
                  {oscarStatus === "connected"
                    ? "Connected"
                    : oscarStatus === "error"
                      ? "Error"
                      : "Not connected"}
                </span>
              </div>

              {oscarError && (
                <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                  <p className="text-sm text-red-800">{oscarError}</p>
                </div>
              )}

              <div className="mt-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    OSCAR Base URL
                  </label>
                  <input
                    type="url"
                    value={oscarBaseUrl}
                    onChange={(e) => setOscarBaseUrl(e.target.value)}
                    placeholder="https://oscar.example.ca/oscar_context"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    disabled={oscarLoading}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Client Key
                  </label>
                  <input
                    type="text"
                    value={oscarClientKey}
                    onChange={(e) => setOscarClientKey(e.target.value)}
                    placeholder="OSCAR REST Client Key"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    disabled={oscarLoading}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Client Secret
                  </label>
                  <input
                    type="password"
                    value={oscarClientSecret}
                    onChange={(e) => setOscarClientSecret(e.target.value)}
                    placeholder={oscarClientSecretMasked ? `Saved (${oscarClientSecretMasked})` : "OSCAR REST Client Secret"}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    disabled={oscarLoading}
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Callback URL: {(appOrigin || "https://mymd.health-assist.org")}/api/admin/emr/oscar/callback
                  </p>
                </div>

                {oscarLastTestedAt && (
                  <p className="text-xs text-slate-500">
                    Last tested: {new Date(oscarLastTestedAt).toLocaleString()}
                  </p>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    onClick={saveOscarConfig}
                    disabled={oscarLoading}
                    className="px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {oscarLoading ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={connectOscar}
                    disabled={oscarLoading || !oscarBaseUrl.trim() || !oscarClientKey.trim()}
                    className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    Connect
                  </button>
                  <button
                    onClick={testOscar}
                    disabled={oscarLoading || oscarStatus !== "connected"}
                    className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    Test Connection
                  </button>
                  <button
                    onClick={disconnectOscar}
                    disabled={oscarLoading || oscarStatus === "not_connected"}
                    className="px-3 py-2 rounded-lg border border-red-300 text-red-700 text-sm font-medium hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200">
                <h2 className="text-lg font-semibold text-slate-900">
                  Providers ({providers.length})
                </h2>
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
                          <div className="text-sm font-medium text-slate-900">
                            {provider.firstName} {provider.lastName}
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            Username: {provider.username}
                            {provider.email && ` • ${provider.email}`}
                            {provider.phone && ` • ${provider.phone}`}
                          </div>
                          <div className="text-xs text-slate-400 mt-1">
                            Intake Link: {(appOrigin || "https://mymd.health-assist.org")}/intake/{provider.uniqueSlug}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/admin/organizations/${organizationId}/providers/${provider.id}/edit`}
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
  );
}

