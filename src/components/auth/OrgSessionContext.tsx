"use client";

/**
 * Exposes the Booking Dashboard authority of the signed-in account to /org client pages.
 *
 * Provided by src/app/org/layout.tsx, which has already resolved it server-side via
 * getOrgAdminContext — this saves pages an extra /api/auth/me round trip, the same
 * reasoning as PhysicianSessionContext.
 */

import { createContext, useContext } from "react";

export interface OrgSessionValue {
  organizationId: string;
  /**
   * True only for organization_users logins. False means a physician reached this page
   * through manages_org_booking, which is also why they can reach /physician/*.
   */
  isOrgAdminAccount: boolean;
  /** Whether to offer a link across to AI Scribe. */
  canAccessPhysicianDashboard: boolean;
}

const OrgSessionContext = createContext<OrgSessionValue | null>(null);

export function OrgSessionProvider({
  value,
  children,
}: {
  value: OrgSessionValue;
  children: React.ReactNode;
}) {
  return <OrgSessionContext.Provider value={value}>{children}</OrgSessionContext.Provider>;
}

/** Returns null outside the /org layout (e.g. in tests). */
export function useOrgSession(): OrgSessionValue | null {
  return useContext(OrgSessionContext);
}
