"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Organization {
  id: string;
  name: string;
  email: string;
  businessAddress: string;
  phone: string | null;
  fax: string | null;
  isActive: boolean;
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

export default function OrgDashboard() {
  const router = useRouter();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      // Fetch organization and providers in parallel
      const [orgResponse, providersResponse] = await Promise.all([
        fetch("/api/org/organization"),
        fetch("/api/org/providers"),
      ]);

      if (orgResponse.status === 401 || providersResponse.status === 401) {
        router.push("/org/login");
        return;
      }

      const orgData = await orgResponse.json();
      const providersData = await providersResponse.json();

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
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-slate-600">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">
                Organization Dashboard
              </h1>
              <p className="text-sm text-slate-600 mt-1">
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
        {error && (
          <div className="mb-6 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Organization Details</h2>
              {organization ? (
                <dl className="space-y-3">
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
                          <div className="text-sm font-medium text-slate-900">
                            {provider.firstName} {provider.lastName}
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
  );
}

