"use client";

/**
 * Shown when a signed-in account without Booking Dashboard authority lands on /org/*.
 *
 * The mirror of ProviderSwitchInterstitial, but deliberately simpler: there is no
 * "act as org admin" endpoint and there should not be one, so this offers links rather
 * than a switch. Before src/app/org/layout.tsx existed these pages rendered their whole
 * shell to anyone and only bounced after the API returned 401.
 */

import Link from "next/link";
import type { UserType } from "@/lib/auth";

interface Props {
  userType: UserType;
  firstName?: string;
}

export default function OrgAccessInterstitial({ userType, firstName }: Props) {
  const isProvider = userType === "provider";
  const account = firstName
    ? `${firstName} (${isProvider ? "provider" : "super admin"})`
    : isProvider
      ? "a provider account"
      : "a super admin account";

  const explanation = isProvider
    ? `You're signed in as ${account}. This account doesn't manage the clinic's Online Booking Dashboard. An organization admin can turn that on from your provider settings — after that, this page and AI Scribe both work from the same login.`
    : `You're signed in as ${account}. Super admin accounts aren't scoped to a single organization, so they administer clinics from the Admin Dashboard instead.`;

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="max-w-2xl mx-auto px-4 py-16">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900">
            This page is the Booking Dashboard
          </h2>
          <p className="mt-1 text-sm text-slate-600">{explanation}</p>

          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={isProvider ? "/physician/dashboard" : "/admin/dashboard"}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition"
            >
              {isProvider ? "Go to Physician Dashboard" : "Go to Admin Dashboard"}
            </Link>
            <Link
              href="/org/login"
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition"
            >
              Sign in as a Booking admin
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
