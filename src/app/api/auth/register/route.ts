/**
 * POST /api/auth/register
 * Physician registration endpoint
 * For now, this is open registration (can be restricted to admin-only later)
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { hashPassword, validatePassword } from "@/lib/auth";
import { randomBytes } from "crypto";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { consumeDbRateLimit } from "@/lib/rate-limit";
import { getRequestIp } from "@/lib/invitation-security";
import {
  assessPasswordAgainstBreaches,
  BREACHED_PASSWORD_ERROR,
  BREACH_CHECK_UNAVAILABLE_ERROR,
} from "@/lib/password-breach";

const REGISTER_MAX_ATTEMPTS = 10;
const REGISTER_WINDOW_SECONDS = 60 * 60;

function generateSlug(firstName: string, lastName: string, clinicName: string): string {
  const clean = (str: string) => str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const first = clean(firstName);
  const last = clean(lastName);
  const clinic = clean(clinicName);
  const random = randomBytes(4).toString("hex");
  return `${first}-${last}-${clinic}-${random}`;
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    if (process.env.AUTH_ALLOW_SELF_REGISTER !== "true") {
      status = 403;
      const res = NextResponse.json(
        { error: "Self-registration is disabled. Contact an administrator." },
        { status },
      );
      logRequestMeta("/api/auth/register", requestId, status, Date.now() - started);
      return res;
    }

    const ip = getRequestIp(request.headers);
    const limiter = await consumeDbRateLimit({
      bucketKey: `auth-register:${ip}`,
      maxAttempts: REGISTER_MAX_ATTEMPTS,
      windowSeconds: REGISTER_WINDOW_SECONDS,
    });
    if (!limiter.allowed) {
      status = 429;
      const res = NextResponse.json(
        {
          error: "Too many registration attempts. Please try again later.",
          retryAfterSeconds: limiter.retryAfterSeconds,
        },
        { status },
      );
      logRequestMeta("/api/auth/register", requestId, status, Date.now() - started);
      return res;
    }

    const body = await request.json();
    const {
      firstName,
      lastName,
      clinicName,
      username,
      password,
      email,
    } = body;

    // Validation
    if (!firstName || !lastName || !clinicName || !username || !password) {
      status = 400;
      const res = NextResponse.json(
        { error: "All required fields must be provided" },
        { status }
      );
      logRequestMeta("/api/auth/register", requestId, status, Date.now() - started);
      return res;
    }

    // Validate password complexity
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      status = 400;
      const res = NextResponse.json(
        { error: passwordValidation.error },
        { status }
      );
      logRequestMeta("/api/auth/register", requestId, status, Date.now() - started);
      return res;
    }

    const breachAssessment = await assessPasswordAgainstBreaches(password);
    if (breachAssessment.unavailable && !breachAssessment.failOpen) {
      status = 503;
      const res = NextResponse.json(
        { error: BREACH_CHECK_UNAVAILABLE_ERROR },
        { status },
      );
      logRequestMeta("/api/auth/register", requestId, status, Date.now() - started);
      return res;
    }
    if (breachAssessment.breached) {
      status = 400;
      const res = NextResponse.json(
        { error: BREACHED_PASSWORD_ERROR },
        { status },
      );
      logRequestMeta("/api/auth/register", requestId, status, Date.now() - started);
      return res;
    }

    // Check if username already exists
    const existingUser = await query(
      `SELECT id FROM physicians WHERE username = $1`,
      [username.toLowerCase().trim()]
    );

    if (existingUser.rows.length > 0) {
      status = 409;
      const res = NextResponse.json(
        { error: "Username already exists" },
        { status }
      );
      logRequestMeta("/api/auth/register", requestId, status, Date.now() - started);
      return res;
    }

    // Check if email already exists (if provided)
    if (email) {
      const existingEmail = await query(
        `SELECT id FROM physicians WHERE email = $1`,
        [email.toLowerCase().trim()]
      );

      if (existingEmail.rows.length > 0) {
        status = 409;
        const res = NextResponse.json(
          { error: "Email already registered" },
          { status }
        );
        logRequestMeta("/api/auth/register", requestId, status, Date.now() - started);
        return res;
      }
    }

    // Generate unique slug
    let uniqueSlug = generateSlug(firstName, lastName, clinicName);
    let attempts = 0;
    while (attempts < 10) {
      const slugCheck = await query(
        `SELECT id FROM physicians WHERE unique_slug = $1`,
        [uniqueSlug]
      );
      if (slugCheck.rows.length === 0) {
        break;
      }
      uniqueSlug = generateSlug(firstName, lastName, clinicName);
      attempts++;
    }

    if (attempts >= 10) {
      status = 500;
      const res = NextResponse.json(
        { error: "Failed to generate unique slug. Please try again." },
        { status }
      );
      logRequestMeta("/api/auth/register", requestId, status, Date.now() - started);
      return res;
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Insert physician
    const result = await query<{ id: string }>(
      `INSERT INTO physicians (first_name, last_name, clinic_name, username, password_hash, unique_slug, email)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        firstName.trim(),
        lastName.trim(),
        clinicName.trim(),
        username.toLowerCase().trim(),
        passwordHash,
        uniqueSlug,
        email ? email.toLowerCase().trim() : null,
      ]
    );

    const physicianId = result.rows[0].id;

    const res = NextResponse.json({
      success: true,
      physician: {
        id: physicianId,
        username: username.toLowerCase().trim(),
        uniqueSlug,
      },
      intakeFormUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/intake/${uniqueSlug}`,
    });
    logRequestMeta("/api/auth/register", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[auth/register] Error");
    const res = NextResponse.json(
      { error: "Internal server error" },
      { status }
    );
    logRequestMeta("/api/auth/register", requestId, status, Date.now() - started);
    return res;
  }
}

