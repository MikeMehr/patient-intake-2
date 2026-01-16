/**
 * POST /api/auth/login
 * Physician login endpoint
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { verifyPassword, createSession, validatePassword } from "@/lib/auth";
import {
  getSuperAdminByUsername,
  getOrgAdminByUsername,
  getProviderByUsername,
} from "@/lib/auth-helpers";
import { logDebug } from "@/lib/secure-logger";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

// Minimal audit helper (avoid PHI/credentials). Wire to real log sink in production.
function auditAuthEvent(event: {
  outcome: "success" | "failure";
  userType?: "super_admin" | "org_admin" | "provider";
  reason?: string;
}) {
  if (process.env.AUDIT_LOG_ENABLED === "true") {
    console.info("[auth/audit]", {
      event: "login",
      outcome: event.outcome,
      userType: event.userType || null,
      reason: event.reason || null,
      ts: new Date().toISOString(),
    });
  }
}

// Simple rate limiting (in production, use Redis or similar)
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const attempts = loginAttempts.get(ip);

  if (!attempts || attempts.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOCKOUT_DURATION });
    return true;
  }

  if (attempts.count >= MAX_ATTEMPTS) {
    return false;
  }

  attempts.count++;
  return true;
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    // Rate limiting
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    if (!checkRateLimit(ip)) {
      auditAuthEvent({ outcome: "failure", reason: "rate_limited" });
      status = 429;
      const res = NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        { status }
      );
      logRequestMeta("/api/auth/login", requestId, status, Date.now() - started);
      return res;
    }

    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      status = 400;
      const res = NextResponse.json(
        { error: "Username and password are required" },
        { status }
      );
      logRequestMeta("/api/auth/login", requestId, status, Date.now() - started);
      return res;
    }

    // Try to find user in order: super_admin, org_admin, provider
    let user: any = null;
    let userType: "super_admin" | "org_admin" | "provider" | null = null;

    // Check super admin first
    const superAdmin = await getSuperAdminByUsername(username);
    if (superAdmin) {
      const isValid = await verifyPassword(password, superAdmin.password_hash);
      if (isValid) {
        user = superAdmin;
        userType = "super_admin";
        await query(`UPDATE super_admin_users SET last_login = NOW() WHERE id = $1`, [user.id]);
      }
    }

    // Check org admin if not found
    if (!user) {
      const orgAdmin = await getOrgAdminByUsername(username);
      if (orgAdmin) {
        const isValid = await verifyPassword(password, orgAdmin.password_hash);
        if (isValid) {
          user = orgAdmin;
          userType = "org_admin";
          await query(`UPDATE organization_users SET last_login = NOW() WHERE id = $1`, [user.id]);
        }
      }
    }

    // Check provider if not found
    if (!user) {
      const provider = await getProviderByUsername(username);
      if (provider) {
        const isValid = await verifyPassword(password, provider.password_hash);
        if (isValid) {
          user = provider;
          userType = "provider";
          await query(`UPDATE physicians SET last_login = NOW() WHERE id = $1`, [user.id]);
        }
      }
    }

    if (!user || !userType) {
      status = 401;
      auditAuthEvent({ outcome: "failure", reason: "invalid_credentials" });
      const res = NextResponse.json(
        { error: "Invalid username or password" },
        { status }
      );
      logRequestMeta("/api/auth/login", requestId, status, Date.now() - started);
      return res;
    }

    // Create session based on user type
    let token: string;
    if (userType === "super_admin") {
      token = await createSession(
        user.id,
        userType,
        user.username,
        user.first_name,
        user.last_name
      );
    } else if (userType === "org_admin") {
      token = await createSession(
        user.id,
        userType,
        user.username,
        user.first_name,
        user.last_name,
        user.organization_id
      );
    } else {
      // provider
      token = await createSession(
        user.id,
        userType,
        user.username,
        user.first_name,
        user.last_name,
        user.organization_id,
        user.clinic_name,
        (user as any).clinic_address ?? null
      );
    }

    // Clear rate limit on successful login
    loginAttempts.delete(ip);

    auditAuthEvent({ outcome: "success", userType });

    // Return appropriate response based on user type
    const response: any = {
      success: true,
      userType,
      user: {
        id: user.id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
      },
    };

    if (userType === "org_admin") {
      response.organizationId = user.organization_id;
    } else if (userType === "provider") {
      response.clinicName = user.clinic_name;
      response.clinicAddress = (user as any).clinic_address ?? null;
      response.uniqueSlug = user.unique_slug;
      response.organizationId = user.organization_id;
    }

    const res = NextResponse.json(response);
    logRequestMeta("/api/auth/login", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[auth/login] Error");
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logDebug("[auth/login] Error details", { errorMessage, errorStack });
    status = 500;
    const res = NextResponse.json(
      { 
        error: "Internal server error",
        details: process.env.NODE_ENV === "development" ? errorMessage : undefined
      },
      { status }
    );
    logRequestMeta("/api/auth/login", requestId, status, Date.now() - started);
    return res;
  }
}

