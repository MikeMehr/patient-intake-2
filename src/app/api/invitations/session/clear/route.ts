import { NextResponse } from "next/server";
import { INVITATION_SESSION_COOKIE } from "@/lib/invitation-security";

/**
 * POST /api/invitations/session/clear
 *
 * Clears the httpOnly invitation session cookie.
 * This is used when a browser has a valid invitation_session cookie from a
 * previous invite, but the user opens a different invite token URL.
 */
export async function POST() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(INVITATION_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    domain: process.env.INVITATION_SESSION_COOKIE_DOMAIN || undefined,
    path: "/",
    maxAge: 0,
  });
  return res;
}

