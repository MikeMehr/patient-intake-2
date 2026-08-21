/**
 * Identity guard for every /org page.
 *
 * Until this existed, /org/* pages were all "use client" with no guard: they rendered the
 * whole Booking Dashboard shell to anonymous visitors, fetched, took a 401, and only then
 * router.push()'d to /org/login. Nothing sensitive leaked — the API enforces — but the
 * shell flash was real and the only authorization boundary was hand-copied into each
 * route handler. proxy.ts cannot do this: it format-checks the cookie and has no DB access.
 *
 * NEW /org PAGES MUST GO INSIDE THIS (protected) GROUP or they get no guard at all. The
 * group exists because /org/login has to stay outside it — a layout that redirects to
 * /org/login while also wrapping it is an infinite loop, and a route group cannot exempt
 * a child from an ancestor layout, only from a sibling one. proxy.ts carries a matching
 * edge check so a page dropped in the wrong place still fails closed for anonymous users.
 */

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSessionForRender } from "@/lib/auth";
import { getOrgAdminContext } from "@/lib/auth-helpers";
import { OrgSessionProvider } from "@/components/auth/OrgSessionContext";
import OrgAccessInterstitial from "@/components/auth/OrgAccessInterstitial";

export default async function OrgLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let session;
  try {
    session = await getSessionForRender();
  } catch (error) {
    // Route handlers deliberately 500 on a DB blip so nobody is logged out mid-task.
    // During render there is no such choice — a 500 page is strictly worse than a login
    // bounce, so we diverge here, matching src/app/physician/layout.tsx.
    console.error("[org/layout] Session lookup failed");
    session = null;
  }

  if (!session) {
    // x-pathname is stamped by proxy.ts. This is the EXPIRED-cookie path (a
    // missing cookie never reaches this layout — the middleware bounces it
    // first), so without returnTo here, a doctor whose session lapsed would
    // sign in and land on the dashboard instead of the page they asked for.
    const requestPath = (await headers()).get("x-pathname") ?? "";
    if (requestPath.startsWith("/org")) {
      redirect(`/org/login?${new URLSearchParams({ returnTo: requestPath })}`);
    }
    redirect("/org/login");
  }

  let orgContext;
  try {
    orgContext = await getOrgAdminContext(session);
  } catch (error) {
    console.error("[org/layout] Booking access lookup failed");
    orgContext = null;
  }

  if (!orgContext) {
    return (
      <OrgAccessInterstitial userType={session.userType} firstName={session.firstName} />
    );
  }

  return (
    <OrgSessionProvider
      value={{
        organizationId: orgContext.organizationId,
        isOrgAdminAccount: orgContext.isOrgAdminAccount,
        // A granted physician holds both surfaces on one session; an organization_users
        // login has no physicians row and cannot reach /physician/* at all.
        canAccessPhysicianDashboard: !orgContext.isOrgAdminAccount,
        currentPhysicianId: orgContext.isOrgAdminAccount ? null : session.userId,
      }}
    >
      {children}
    </OrgSessionProvider>
  );
}
