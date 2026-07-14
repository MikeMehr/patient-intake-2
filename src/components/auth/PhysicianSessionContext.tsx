"use client";

/**
 * Exposes the identity of the signed-in account to /physician client pages.
 *
 * Provided by src/app/physician/layout.tsx, which has already loaded the session
 * server-side — this saves pages an extra /api/auth/me round trip. userId is the
 * account that is actually signed in (an assistant's own id, not the physician
 * they act for), so it is safe to use for per-account client storage keys.
 */

import { createContext, useContext } from "react";

export interface PhysicianSessionValue {
  userId: string;
}

const PhysicianSessionContext = createContext<PhysicianSessionValue | null>(null);

export function PhysicianSessionProvider({
  value,
  children,
}: {
  value: PhysicianSessionValue;
  children: React.ReactNode;
}) {
  return (
    <PhysicianSessionContext.Provider value={value}>
      {children}
    </PhysicianSessionContext.Provider>
  );
}

/** Returns null outside the /physician layout (e.g. in tests). */
export function usePhysicianSession(): PhysicianSessionValue | null {
  return useContext(PhysicianSessionContext);
}
