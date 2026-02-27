"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";

export default function EditOrgProviderPage() {
  const router = useRouter();
  const params = useParams();
  const providerId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    clinicName: "",
    username: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
    mfaEnabled: false,
  });
  const [backupCodeStatus, setBackupCodeStatus] = useState<{
    activeCodes: number;
    lastGeneratedAt: string | null;
  } | null>(null);
  const [generatedBackupCodes, setGeneratedBackupCodes] = useState<string[]>([]);

  useEffect(() => {
    fetchProvider();
  }, [providerId]);

  const fetchProvider = async () => {
    try {
      const response = await fetch(`/api/org/providers/${providerId}`);
      if (response.status === 401) {
        router.push("/org/login");
        return;
      }
      const data = await response.json();
      if (data.error) {
        setError(data.error);
      } else {
        const provider = data.provider;
        setFormData({
          firstName: provider.firstName,
          lastName: provider.lastName,
          clinicName: provider.clinicName,
          username: provider.username,
          email: provider.email || "",
          phone: provider.phone || "",
          password: "",
          confirmPassword: "",
          mfaEnabled: Boolean(provider.mfaEnabled),
        });
        await fetchBackupCodeStatus();
      }
    } catch (err) {
      console.error("Error fetching provider:", err);
      setError("Failed to load provider details");
    } finally {
      setLoading(false);
    }
  };

  const fetchBackupCodeStatus = async () => {
    try {
      const response = await fetch(`/api/org/providers/${providerId}/mfa/backup-codes`);
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.backupCodes) {
        setBackupCodeStatus(data.backupCodes);
      }
    } catch {
      // Non-fatal for edit form; status panel can stay empty.
    }
  };

  const handleBackupCodesAction = async (action: "generate" | "rotate") => {
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/org/providers/${providerId}/mfa/backup-codes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Failed to manage backup codes");
        setSaving(false);
        return;
      }
      setGeneratedBackupCodes(Array.isArray(data.backupCodes) ? data.backupCodes : []);
      setBackupCodeStatus(data.status || null);
      setSuccess(
        action === "rotate"
          ? "Backup recovery codes rotated successfully."
          : "Backup recovery codes generated successfully.",
      );
    } catch {
      setError("An error occurred while managing backup codes.");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const updateData: any = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        clinicName: formData.clinicName,
        email: formData.email || null,
        phone: formData.phone || null,
        mfaEnabled: formData.mfaEnabled,
      };

      // Only include password if it's been changed
      if (formData.password) {
        if (formData.password !== formData.confirmPassword) {
          setError("New password and confirm password do not match.");
          setSaving(false);
          return;
        }
        updateData.password = formData.password;
      }

      const response = await fetch(`/api/org/providers/${providerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to update provider");
        setSaving(false);
        return;
      }

      setSuccess("Provider updated successfully!");
      setFormData({ ...formData, password: "", confirmPassword: "" }); // Clear password fields
      setSaving(false);
    } catch (err) {
      setError("An error occurred. Please try again.");
      setSaving(false);
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
              <Link
                href="/org/dashboard"
                className="text-sm text-slate-600 hover:text-slate-900 mb-2 inline-block"
              >
                ← Back to Dashboard
              </Link>
              <h1 className="text-2xl font-semibold text-slate-900">Edit Provider</h1>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-900">Multi-factor authentication</p>
                  <p className="text-xs text-slate-600">
                    Require email verification codes at sign-in for this provider account.
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={formData.mfaEnabled}
                    onChange={(e) => setFormData({ ...formData, mfaEnabled: e.target.checked })}
                    disabled={saving}
                    className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                  />
                  MFA enabled
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 p-4">
              <p className="text-sm font-medium text-slate-900">Backup recovery codes</p>
              <p className="mt-1 text-xs text-slate-600">
                Use once-only backup codes if email OTP is unavailable.
              </p>
              <p className="mt-2 text-xs text-slate-700">
                Active codes: <span className="font-semibold">{backupCodeStatus?.activeCodes ?? 0}</span>
              </p>
              {backupCodeStatus?.lastGeneratedAt && (
                <p className="mt-1 text-xs text-slate-600">
                  Last generated: {new Date(backupCodeStatus.lastGeneratedAt).toLocaleString()}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleBackupCodesAction("generate")}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  Generate codes
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleBackupCodesAction("rotate")}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  Rotate codes
                </button>
              </div>
              {generatedBackupCodes.length > 0 && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-medium text-amber-900">
                    Save these backup codes now. They are shown only once:
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {generatedBackupCodes.map((code) => (
                      <code key={code} className="rounded bg-white px-2 py-1 text-xs text-slate-900">
                        {code}
                      </code>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6">
          {error && (
            <div className="mb-6 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {success && (
            <div className="mb-6 rounded-lg bg-green-50 border border-green-200 px-4 py-3">
              <p className="text-sm text-green-800">{success}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="firstName"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  First Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="firstName"
                  type="text"
                  required
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                />
              </div>

              <div>
                <label
                  htmlFor="lastName"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Last Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="lastName"
                  type="text"
                  required
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="clinicName"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Clinic Name <span className="text-red-500">*</span>
              </label>
              <input
                id="clinicName"
                type="text"
                required
                value={formData.clinicName}
                onChange={(e) => setFormData({ ...formData, clinicName: e.target.value })}
                disabled={saving}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
              />
            </div>

            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Username
              </label>
              <input
                id="username"
                type="text"
                value={formData.username}
                disabled
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-base text-slate-500 cursor-not-allowed"
              />
              <p className="mt-1 text-xs text-slate-500">Username cannot be changed</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                />
              </div>

              <div>
                <label
                  htmlFor="phone"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Phone
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                New Password (leave blank to keep current)
              </label>
              <input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                disabled={saving}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
              />
              <p className="mt-1 text-xs text-slate-500">
                Must be at least 8 characters with letters and numbers
              </p>
            </div>
            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Confirm New Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                disabled={saving}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
              />
            </div>

            <div className="flex items-center justify-end gap-4 pt-4">
              <Link
                href="/org/dashboard"
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

