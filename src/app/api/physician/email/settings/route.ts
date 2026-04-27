/**
 * GET /api/physician/email/settings  - Get physician's default email body
 * PUT /api/physician/email/settings  - Upsert physician's default email body
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "provider") {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/physician/email/settings", requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = getEffectivePhysicianId(session);

    const result = await query<{ default_body: string }>(
      `SELECT default_body FROM physician_email_settings WHERE physician_id = $1`,
      [physicianId]
    );

    let defaultBody = result.rows[0]?.default_body ?? "";

    if (!defaultBody) {
      const profileResult = await query<{
        first_name: string;
        last_name: string;
        clinic_name: string;
        address: string | null;
      }>(
        `SELECT p.first_name, p.last_name, p.clinic_name,
                COALESCE(NULLIF(p.clinic_address, ''), o.business_address) AS address
         FROM physicians p
         LEFT JOIN organizations o ON o.id = p.organization_id
         WHERE p.id = $1`,
        [physicianId]
      );

      if (profileResult.rows[0]) {
        const { first_name, last_name, clinic_name, address } = profileResult.rows[0];
        const addressLines = (address || "")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => `<p>${l}</p>`)
          .join("");
        const disclaimer =
          "This email and any files transmitted with it are considered confidential and are intended " +
          "only for the use of the individual(s) to whom they are addressed (intended). If you are not " +
          "the intended recipient (received in error) or the person responsible for delivering the email " +
          "to the intended recipient, be advised that you have received this email in error and that any " +
          "use, dissemination, forwarding, printing or copying of this email is strictly prohibited. " +
          "If you have received this email in error, please notify the sender immediately.";
        defaultBody =
          `<p>Regards,</p>` +
          `<p>Office of Dr. ${first_name} ${last_name}</p>` +
          `<p><strong>${clinic_name}</strong></p>` +
          addressLines +
          `<p><em>${disclaimer}</em></p>` +
          `<p>Thank you.</p>`;
      }
    }

    const res = NextResponse.json({ defaultBody }, { status });
    logRequestMeta("/api/physician/email/settings", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/physician/email/settings GET] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/physician/email/settings", requestId, status, Date.now() - started);
    return res;
  }
}

export async function PUT(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "provider") {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/physician/email/settings", requestId, status, Date.now() - started);
      return res;
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      status = 400;
      const res = NextResponse.json({ error: "Invalid JSON body." }, { status });
      logRequestMeta("/api/physician/email/settings", requestId, status, Date.now() - started);
      return res;
    }

    const { defaultBody } = (body || {}) as { defaultBody?: string };

    const physicianId = getEffectivePhysicianId(session);

    await query(
      `INSERT INTO physician_email_settings (physician_id, default_body, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (physician_id)
       DO UPDATE SET default_body = $2, updated_at = NOW()`,
      [physicianId, (defaultBody || "").trim()]
    );

    const res = NextResponse.json({ success: true }, { status });
    logRequestMeta("/api/physician/email/settings", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/physician/email/settings PUT] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/physician/email/settings", requestId, status, Date.now() - started);
    return res;
  }
}
