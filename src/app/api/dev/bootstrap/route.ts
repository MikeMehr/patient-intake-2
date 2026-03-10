/**
 * POST /api/dev/bootstrap
 *
 * Dev-only: Create a local invitation session for guided interview testing
 * without real invitations or OTP verification.
 *
 * Enabled only when NODE_ENV=development AND ENABLE_DEV_INTERVIEW_HARNESS=true.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { query } from "@/lib/db";
import {
  createInvitationSession,
  hashValue,
  INVITATION_SESSION_COOKIE,
} from "@/lib/invitation-security";

const INVITATION_SESSION_TTL_HOURS = 1;

function isDevHarnessEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.ENABLE_DEV_INTERVIEW_HARNESS === "true"
  );
}

export async function POST(request: NextRequest) {
  if (!isDevHarnessEnabled()) {
    return NextResponse.json(
      { error: "Dev interview harness is not enabled" },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const {
      physicianId: inputPhysicianId,
      physicianSlug: inputPhysicianSlug,
      patientName,
      patientEmail,
      patientDob,
    } = (body || {}) as {
      physicianId?: string;
      physicianSlug?: string;
      patientName?: string;
      patientEmail?: string;
      patientDob?: string;
    };

    const name = (patientName || "Dev Test Patient").trim();
    const email = (patientEmail || "dev-test@example.com").trim().toLowerCase();
    const dob = patientDob ? String(patientDob).trim() || null : null;

    let physicianId = (inputPhysicianId || "").trim();
    const physicianSlug = (inputPhysicianSlug || "").trim();

    if (physicianSlug && !physicianId) {
      const bySlug = await query<{ id: string }>(
        `SELECT id FROM physicians WHERE unique_slug = $1 LIMIT 1`,
        [physicianSlug]
      );
      if (bySlug.rows.length > 0) {
        physicianId = bySlug.rows[0].id;
      }
    }

    if (!physicianId) {
      const firstPhysician = await query<{ id: string }>(
        `SELECT id FROM physicians LIMIT 1`
      );
      if (firstPhysician.rows.length === 0) {
        return NextResponse.json(
          {
            error:
              "No physician found. Add a physician to the database or provide physicianId/physicianSlug.",
          },
          { status: 400 }
        );
      }
      physicianId = firstPhysician.rows[0].id;
    }

    const physicianResult = await query<{
      first_name: string;
      last_name: string;
      clinic_name: string;
    }>(
      `SELECT first_name, last_name, clinic_name
       FROM physicians
       WHERE id = $1`,
      [physicianId]
    );

    if (physicianResult.rows.length === 0) {
      return NextResponse.json(
        { error: "Physician not found" },
        { status: 404 }
      );
    }

    const physician = physicianResult.rows[0];
    const physicianName = `Dr. ${physician.first_name} ${physician.last_name}`;

    const devTokenHash = hashValue(
      `dev-harness-${Date.now()}-${randomBytes(8).toString("hex")}`
    );
    const expiresAt = new Date(
      Date.now() + INVITATION_SESSION_TTL_HOURS * 60 * 60 * 1000
    );

    const invitationResult = await query<{ id: string }>(
      `INSERT INTO patient_invitations (
         physician_id,
         patient_name,
         patient_email,
         patient_dob,
         invitation_link,
         token_hash,
         token_expires_at,
         expires_at,
         sent_at
       )
       VALUES ($1, $2, $3, $4::date, NULL, $5, $6, $6, NOW())
       RETURNING id`,
      [physicianId, name, email, dob || null, devTokenHash, expiresAt]
    );

    const invitationId = invitationResult.rows[0]?.id;
    if (!invitationId) {
      return NextResponse.json(
        { error: "Failed to create dev invitation" },
        { status: 500 }
      );
    }

    const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      null;
    const userAgent = request.headers.get("user-agent") || null;

    const { cookieValue, expiresAtMs } = await createInvitationSession({
      invitationId,
      ipAddress,
      userAgent,
    });

    const expiresAtDate = new Date(expiresAtMs);
    const patientDobIso = dob && /^\d{4}-\d{2}-\d{2}$/.test(dob) ? dob : null;

    const context = {
      invitationId,
      physicianId,
      physicianName,
      clinicName: physician.clinic_name,
      patientName: name,
      patientEmail: email,
      patientDob: patientDobIso,
      organizationWebsiteUrl: null as string | null,
    };

    const response = NextResponse.json(context);
    response.cookies.set(INVITATION_SESSION_COOKIE, cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor((expiresAtDate.getTime() - Date.now()) / 1000),
    });

    return response;
  } catch (error) {
    console.error("[dev/bootstrap] Error:", error);
    return NextResponse.json(
      { error: "Failed to create dev invitation session" },
      { status: 500 }
    );
  }
}
