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

  useEffect(() => {
    if (organizationId) {
      fetchOrganizationDetails();
    }
  }, [organizationId]);

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
        setProviders(data.providers || []);
      }
    } catch (err) {
      console.error("Error fetching organization:", err);
      setError("Failed to load organization details");
    } finally {
      setLoading(false);
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
                            Intake Link: {process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}
                            /intake/{provider.uniqueSlug}
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

