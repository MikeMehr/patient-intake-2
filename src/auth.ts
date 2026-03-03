/**
 * NextAuth v5 auth configuration
 * This file exports the auth function used by NextAuth v5
 */

import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import type { NextAuthConfig } from "next-auth";

function resolveAllowedGoogleDomains(): string[] {
  return (process.env.GOOGLE_ALLOWED_DOMAINS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function getEmailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

const config = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }: any) {
      // Default deny unless explicitly enabled for a controlled rollout.
      if (process.env.ENABLE_GOOGLE_SSO !== "true") {
        return false;
      }

      if (account?.provider !== "google") {
        return false;
      }

      const email = String(user?.email || profile?.email || "").trim().toLowerCase();
      if (!email) {
        return false;
      }

      const allowedDomains = resolveAllowedGoogleDomains();
      if (allowedDomains.length === 0) {
        // Explicitly require allowlisted domains when SSO is enabled.
        return false;
      }

      return allowedDomains.includes(getEmailDomain(email));
    },
    async session({ session, token }: any) {
      if (session.user) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
  debug: process.env.NODE_ENV === "development",
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(config);



















