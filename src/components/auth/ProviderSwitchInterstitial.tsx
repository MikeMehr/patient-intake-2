"use client";

/**
 * Shown when a Booking-admin session lands on a provider workspace.
 *
 * The app keeps one session cookie for all account types, so switching to the
 * Booking Dashboard replaces the provider session in every open tab. This lets
 * the user switch back to a provider in one click rather than logging out.
 *
 * mode="page"   full-screen, rendered by src/app/physician/layout.tsx.
 * mode="inline" banner inside a page that has unsaved work; switching in place
 *               keeps that work, so it must not navigate.
 */

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import type { UserType } from "@/lib/auth";

interface Provider {
  id: string;
  firstName: string;
  lastName: string;
}

interface Props {
  mode: "page" | "inline";
  /**
   * Omit in inline mode: the page only learns a 403 happened, and /api/auth/me
   * does not expose userType. We then probe /api/org/providers and fall back to
   * links if it rejects us. In practice inline is always an org admin, since
   * /api/org/return-to-admin only ever mints org_admin sessions.
   */
  userType?: Extract<UserType, "org_admin" | "super_admin">;
  firstName?: string;
  /** inline only: called after the provider session is minted, instead of navigating. */
  onSwitched?: () => void;
}

export default function ProviderSwitchInterstitial({
  mode,
  userType,
  firstName,
  onSwitched,
}: Props) {
  const pathname = usePathname();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(userType !== "super_admin");
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // GET /api/org/providers requires userType === "org_admin" and 401s for super
  // admins, and no equivalent endpoint exists for them — so there is no picker
  // to show and we offer links instead.
  const [canListProviders, setCanListProviders] = useState(userType !== "super_admin");

  useEffect(() => {
    if (userType === "super_admin") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/org/providers");
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setCanListProviders(false);
        } else if (!res.ok || data.error) {
          setError(data.error || "Unable to load your providers.");
        } else {
          setProviders(data.providers || []);
        }
      } catch {
        if (!cancelled) setError("Unable to load your providers.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userType]);

  const handleSwitch = useCallback(
    async (providerId: string) => {
      setSwitchingId(providerId);
      setError(null);
      try {
        const res = await fetch("/api/org/act-as-provider", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "Unable to continue as this provider.");
          setSwitchingId(null);
          return;
        }
        if (mode === "inline") {
          // Deliberately no navigation: a reload would discard unsaved work,
          // which is the whole point of recovering in place.
          onSwitched?.();
          setSwitchingId(null);
          return;
        }
        // Full load so the layout re-runs against the new cookie. router.refresh()
        // would not pick up a cookie set by a fetch response.
        window.location.href = pathname;
      } catch {
        setError("Unable to continue as this provider.");
        setSwitchingId(null);
      }
    },
    [mode, onSwitched, pathname],
  );

  const heading =
    mode === "inline"
      ? "Your session switched to the Booking admin account"
      : "This page is a provider workspace";

  // firstName is absent in inline mode (the page only knows a 403 happened), so
  // fall back to naming the role rather than rendering an empty parenthetical.
  const account = firstName
    ? `${firstName} (${canListProviders ? "Booking admin" : "Super admin"})`
    : canListProviders
      ? "the Booking admin account"
      : "a Super admin account";

  const explanation = !canListProviders
    ? `You're signed in as ${account}. Open a provider's workspace from their organization's Booking Dashboard.`
    : `You're signed in as ${account}, not a provider. Returning to the Booking Dashboard signs every open tab in as the admin, which is why this page can't continue.`;

  const body = (
    <div>
      <h2 className="text-lg font-semibold text-slate-900">{heading}</h2>
      <p className="mt-1 text-sm text-slate-600">{explanation}</p>

      {error && (
        <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {!canListProviders ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/admin/dashboard"
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition"
          >
            Go to Admin Dashboard
          </Link>
          <Link
            href="/auth/login"
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition"
          >
            Sign in as a provider
          </Link>
        </div>
      ) : loading ? (
        <p className="mt-4 text-sm text-slate-500">Loading your providers…</p>
      ) : providers.length === 0 ? (
        <div className="mt-4">
          <p className="text-sm text-slate-600">
            Your organization has no providers to continue as.
          </p>
          <Link
            href="/org/dashboard"
            className="mt-3 inline-block px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition"
          >
            Back to Booking Dashboard
          </Link>
        </div>
      ) : (
        <div className="mt-4">
          <p className="text-sm font-medium text-slate-700">Continue as:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {providers.map((p) => (
              <button
                key={p.id}
                onClick={() => handleSwitch(p.id)}
                disabled={switchingId !== null}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                {switchingId === p.id
                  ? "Switching…"
                  : `Dr. ${p.firstName} ${p.lastName}`}
              </button>
            ))}
          </div>
          <Link
            href="/org/dashboard"
            className="mt-3 inline-block text-sm text-slate-600 underline hover:text-slate-900"
          >
            Back to Booking Dashboard
          </Link>
        </div>
      )}
    </div>
  );

  if (mode === "inline") {
    return (
      <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
        {body}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="max-w-2xl mx-auto px-4 py-16">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          {body}
        </div>
      </div>
    </div>
  );
}
