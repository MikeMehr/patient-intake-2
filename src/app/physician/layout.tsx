/**
 * Identity guard for every /physician page.
 *
 * The app stores one session cookie for all account types, so returning to the
 * Booking Dashboard replaces the provider session in every open tab. Without
 * this guard those tabs keep rendering as if nothing happened and only fail at
 * the API call — e.g. Generate SOAP rejecting a finished transcript with 403.
 * proxy.ts cannot do this: it only format-checks the cookie and has no DB access.
 *
 * Checking here means a non-provider never mounts the page at all, so the
 * failure surfaces before any work is typed rather than after.
 */

import { redirect } from "next/navigation";
import { getSessionForRender } from "@/lib/auth";
import ProviderSwitchInterstitial from "@/components/auth/ProviderSwitchInterstitial";
import { PhysicianSessionProvider } from "@/components/auth/PhysicianSessionContext";

export default async function PhysicianLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let session;
  try {
    session = await getSessionForRender();
  } catch (error) {
    // Route handlers deliberately 500 on a DB blip so a physician isn't logged
    // out mid-encounter. During render there is no such choice — a 500 error
    // page is strictly worse than a login bounce, so we diverge here.
    console.error("[physician/layout] Session lookup failed");
    session = null;
  }

  if (!session) {
    redirect("/auth/login");
  }

  // Assistants are userType "provider" with linkedPhysicianId set, so they pass.
  if (session.userType !== "provider") {
    return (
      <ProviderSwitchInterstitial
        mode="page"
        userType={session.userType}
        firstName={session.firstName}
      />
    );
  }

  return (
    <PhysicianSessionProvider value={{ userId: session.userId }}>
      {children}
    </PhysicianSessionProvider>
  );
}
