"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SessionKeepAlive from "@/components/auth/SessionKeepAlive";

interface Organization {
  id: string;
  name: string;
  email: string;
  businessAddress: string;
  phone: string | null;
  fax: string | null;
  isActive: boolean;
  createdAt: string;
  providerCount: number;
}

interface WorkforceUser {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  mfaEnabled: boolean;
  backupCodesRequired: boolean;
  recoveryResetAt: string | null;
  organizationName?: string;
}

export default function SuperAdminDashboard() {
  const router = useRouter();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [workforceLoading, setWorkforceLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workforceError, setWorkforceError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [superAdmins, setSuperAdmins] = useState<WorkforceUser[]>([]);
  const [orgAdmins, setOrgAdmins] = useState<WorkforceUser[]>([]);

  useEffect(() => {
    fetchOrganizations();
    fetchWorkforce();
  }, []);

  const fetchOrganizations = async () => {
    try {
      const response = await fetch("/api/admin/organizations");
      if (response.status === 401) {
        router.push("/admin/login");
        return;
      }
      const data = await response.json();
      if (data.error) {
        setError(data.error);
      } else {
        setOrganizations(data.organizations || []);
      }
    } catch (err) {
      console.error("Error fetching organizations:", err);
      setError("Failed to load organizations");
    } finally {
      setLoading(false);
    }
  };

  const fetchWorkforce = async () => {
    try {
      const response = await fetch("/api/admin/workforce");
      if (response.status === 401) {
        router.push("/admin/login");
        return;
      }
      const data = await response.json();
      if (data.error) {
        setWorkforceError(data.error);
      } else {
        setSuperAdmins(data.superAdmins || []);
        setOrgAdmins(data.orgAdmins || []);
      }
    } catch (err) {
      console.error("Error fetching workforce:", err);
      setWorkforceError("Failed to load workforce MFA controls");
    } finally {
      setWorkforceLoading(false);
    }
  };

  const runRecoveryAction = async (path: string, body?: Record<string, unknown>) => {
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(data.error || "Action failed");
        return;
      }
      if (Array.isArray(data.backupCodes) && data.backupCodes.length > 0) {
        alert(`Save these codes now (shown once):\n${data.backupCodes.join("\n")}`);
      }
      await fetchWorkforce();
    } catch (err) {
      console.error("Recovery action failed:", err);
      alert("Action failed");
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/admin/login");
      router.refresh();
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  const filteredOrganizations = organizations.filter((org) =>
    org.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    org.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <>
        <SessionKeepAlive redirectTo="/admin/login" />
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-slate-600">Loading...</p>
        </div>
      </>
    );
  }

  return (
    <>
      <SessionKeepAlive redirectTo="/admin/login" />
      <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">
                Super Admin Dashboard
              </h1>
              <p className="text-sm text-slate-600 mt-1">
                Manage organizations and providers
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
        {workforceError && (
          <div className="mb-6 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-800">{workforceError}</p>
          </div>
        )}

        <div className="mb-6 flex items-center justify-between">
          <div className="flex-1 max-w-md">
            <input
              type="text"
              placeholder="Search organizations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
          </div>
          <Link
            href="/admin/organizations/new"
            className="ml-4 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition"
          >
            Add Organization
          </Link>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Organization
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Providers
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
              {filteredOrganizations.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-slate-500">
                    {organizations.length === 0
                      ? "No organizations yet. Click 'Add Organization' to get started."
                      : "No organizations match your search."}
                  </td>
                </tr>
              ) : (
                filteredOrganizations.map((org) => (
                  <tr key={org.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-slate-900">{org.name}</div>
                      <div className="text-xs text-slate-500">{org.businessAddress}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-slate-900">{org.email}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-slate-900">{org.providerCount}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          org.isActive
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {org.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <Link
                        href={`/admin/organizations/${org.id}`}
                        className="text-slate-600 hover:text-slate-900 mr-4"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-8 bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900">Workforce MFA Recovery Controls</h2>
            <p className="text-xs text-slate-500 mt-1">
              Admin reset keeps MFA enabled and invalidates old backup codes until regeneration.
            </p>
          </div>
          {workforceLoading ? (
            <div className="px-6 py-6 text-sm text-slate-500">Loading workforce controls...</div>
          ) : (
            <div className="p-6 space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 mb-2">Super Admin Accounts</h3>
                <div className="space-y-2">
                  {superAdmins.map((user) => (
                    <div key={user.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-900">
                            {user.firstName} {user.lastName} ({user.username})
                          </p>
                          <p className="text-xs text-slate-500">
                            {user.email} • Backup codes required: {user.backupCodesRequired ? "Yes" : "No"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              runRecoveryAction(`/api/admin/super-admin-users/${user.id}/mfa/backup-codes`, {
                                action: "generate",
                              })
                            }
                            className="px-2 py-1 text-xs rounded border border-slate-300 hover:bg-slate-50"
                          >
                            Generate codes
                          </button>
                          <button
                            onClick={() =>
                              runRecoveryAction(`/api/admin/super-admin-users/${user.id}/mfa/backup-codes`, {
                                action: "rotate",
                              })
                            }
                            className="px-2 py-1 text-xs rounded border border-slate-300 hover:bg-slate-50"
                          >
                            Rotate codes
                          </button>
                          <button
                            onClick={() =>
                              runRecoveryAction(`/api/admin/super-admin-users/${user.id}/mfa/reset-recovery`)
                            }
                            className="px-2 py-1 text-xs rounded border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                          >
                            Admin reset MFA recovery
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-900 mb-2">Organization Admin Accounts</h3>
                <div className="space-y-2">
                  {orgAdmins.map((user) => (
                    <div key={user.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-900">
                            {user.firstName} {user.lastName} ({user.username})
                          </p>
                          <p className="text-xs text-slate-500">
                            {user.organizationName} • {user.email} • Backup codes required:{" "}
                            {user.backupCodesRequired ? "Yes" : "No"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              runRecoveryAction(`/api/admin/organization-users/${user.id}/mfa/backup-codes`, {
                                action: "generate",
                              })
                            }
                            className="px-2 py-1 text-xs rounded border border-slate-300 hover:bg-slate-50"
                          >
                            Generate codes
                          </button>
                          <button
                            onClick={() =>
                              runRecoveryAction(`/api/admin/organization-users/${user.id}/mfa/backup-codes`, {
                                action: "rotate",
                              })
                            }
                            className="px-2 py-1 text-xs rounded border border-slate-300 hover:bg-slate-50"
                          >
                            Rotate codes
                          </button>
                          <button
                            onClick={() =>
                              runRecoveryAction(`/api/admin/organization-users/${user.id}/mfa/reset-recovery`)
                            }
                            className="px-2 py-1 text-xs rounded border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                          >
                            Admin reset MFA recovery
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
    </>
  );
}

