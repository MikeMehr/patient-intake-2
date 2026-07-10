/**
 * POST /api/interview-intake/[clinicSlug]/demographics
 *
 * New-patient step of the self-serve guided interview. Stashes the full
 * demographics on the (self-serve) invitation row as `pending_oscar_demographics`
 * so the OSCAR chart can be created later — only once the patient actually
 * completes/ends the interview (handled in POST /api/sessions).
 *
 * The health card number is encrypted at rest inside the JSON blob.
 *
 * Body: { token, gender, address, city, province, postal, coverageType?, healthCardNumber? }
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { encryptString } from "@/lib/encrypted-field";
import { consumeRateLimit, getRequestIp, hashValue } from "@/lib/invitation-security";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export const runtime = "nodejs";

const MAX_FIELD_LEN = 200;

function truncate(val: unknown, max = MAX_FIELD_LEN): string {
  return String(val ?? "").trim().slice(0, max);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clinicSlug: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  const route = "/api/interview-intake/demographics";

  try {
    await params; // clinicSlug not needed beyond routing; token identifies the invitation
    const ip = getRequestIp(request.headers);

    const ipLimit = await consumeRateLimit(`interview-intake-demographics:${ip}`, 12, 600);
    if (!ipLimit.allowed) {
      status = 429;
      const res = NextResponse.json(
        { error: "Too many requests. Please try again shortly." },
        { status, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } },
      );
      logRequestMeta(route, requestId, status, Date.now() - started);
      return res;
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      status = 400;
      const res = NextResponse.json({ error: "Invalid JSON" }, { status });
      logRequestMeta(route, requestId, status, Date.now() - started);
      return res;
    }

    const token = String(body.token ?? "").trim();
    if (!token) {
      status = 400;
      const res = NextResponse.json({ error: "Missing token." }, { status });
      logRequestMeta(route, requestId, status, Date.now() - started);
      return res;
    }

    const gender = truncate(body.gender, 1).toUpperCase();
    const address = truncate(body.address);
    const city = truncate(body.city, 100);
    const province = truncate(body.province, 50);
    const postal = truncate(body.postal, 10);
    const coverageType = truncate(body.coverageType, 40) || null;
    const healthCardNumberRaw = truncate(body.healthCardNumber, 40);

    if (!address || !city || !province || !postal) {
      status = 400;
      const res = NextResponse.json(
        { error: "Address, city, province, and postal code are required." },
        { status },
      );
      logRequestMeta(route, requestId, status, Date.now() - started);
      return res;
    }

    // Resolve the invitation strictly by hashed token, and require it to be a
    // live self-serve invitation for a NEW patient (no OSCAR chart yet).
    const tokenHash = hashValue(token);
    const inv = await query<{
      id: string;
      is_self_serve: boolean;
      oscar_demographic_no: string | null;
      used_at: string | null;
      revoked_at: string | null;
      token_expires_at: string | null;
      expires_at: string | null;
    }>(
      `SELECT id, is_self_serve, oscar_demographic_no, used_at, revoked_at,
              token_expires_at, expires_at
       FROM patient_invitations
       WHERE token_hash = $1
       ORDER BY sent_at DESC NULLS LAST, created_at DESC NULLS LAST
       LIMIT 1`,
      [tokenHash],
    );

    const row = inv.rows[0];
    if (!row || !row.is_self_serve) {
      status = 404;
      const res = NextResponse.json({ error: "Invitation not found." }, { status });
      logRequestMeta(route, requestId, status, Date.now() - started);
      return res;
    }
    if (row.oscar_demographic_no) {
      // Existing patient — demographics collection does not apply.
      status = 409;
      const res = NextResponse.json(
        { error: "This patient already has a chart; demographics are not required." },
        { status },
      );
      logRequestMeta(route, requestId, status, Date.now() - started);
      return res;
    }
    const expiry = row.token_expires_at || row.expires_at;
    const openable =
      !row.revoked_at && !row.used_at && (!expiry || new Date(expiry).getTime() > Date.now());
    if (!openable) {
      status = 410;
      const res = NextResponse.json({ error: "This session has expired." }, { status });
      logRequestMeta(route, requestId, status, Date.now() - started);
      return res;
    }

    // Encrypt the health card number (matches how booking stores health_card_number_enc).
    let healthCardEnc: string | null = null;
    if (healthCardNumberRaw) {
      try {
        healthCardEnc = encryptString(healthCardNumberRaw);
      } catch {
        healthCardEnc = null;
      }
    }

    const pending = {
      gender: ["M", "F", "O", "U"].includes(gender) ? gender : "U",
      address,
      city,
      province,
      postal,
      coverageType,
      healthCardEnc,
    };

    await query(
      `UPDATE patient_invitations
       SET pending_oscar_demographics = $1::jsonb
       WHERE id = $2`,
      [JSON.stringify(pending), row.id],
    );

    const res = NextResponse.json({ ok: true });
    logRequestMeta(route, requestId, status, Date.now() - started);
    return res;
  } catch (err) {
    console.error("[interview-intake/demographics] Unhandled error:", err);
    status = 500;
    const res = NextResponse.json({ error: "An unexpected error occurred." }, { status });
    logRequestMeta(route, requestId, status, Date.now() - started);
    return res;
  }
}
