/**
 * POST /api/invitations/send
 * Send patient invitation email
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { Resend } from "resend";
import { logDebug } from "@/lib/secure-logger";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { startInvitationCleanup } from "@/lib/invitations-cleanup";
import {
  buildInvitationUploadSummaries,
  type InvitationUploadSummaries,
} from "@/lib/invitation-pdf-summary";
import {
  createInvitationToken,
  logInvitationAudit,
} from "@/lib/invitation-security";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export async function POST(request: NextRequest) {
  startInvitationCleanup();

  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    // Require authentication
    const session = await getCurrentSession();
    if (!session) {
      status = 401;
      const res = NextResponse.json(
        { error: "Authentication required" },
        { status }
      );
      logRequestMeta("/api/invitations/send", requestId, status, Date.now() - started);
      return res;
    }

    // Only providers can send invitations
    if (session.userType !== "provider") {
      status = 403;
      const res = NextResponse.json(
        { error: "Only providers can send patient invitations" },
        { status }
      );
      logRequestMeta("/api/invitations/send", requestId, status, Date.now() - started);
      return res;
    }

    const {
      patientName,
      patientEmail,
      patientBackground,
      oscarDemographicNo,
      labReportFile,
      previousLabReportFile,
      formFile,
    } =
      await parseRequestBody(request);

    if (!patientName || !patientEmail) {
      status = 400;
      const res = NextResponse.json(
        { error: "Patient name and email are required" },
        { status }
      );
      logRequestMeta("/api/invitations/send", requestId, status, Date.now() - started);
      return res;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(patientEmail)) {
      status = 400;
      const res = NextResponse.json(
        { error: "Invalid email address" },
        { status }
      );
      logRequestMeta("/api/invitations/send", requestId, status, Date.now() - started);
      return res;
    }

    // Get physician details including slug
    // Use userId for the new session format, or fall back to physicianId for legacy sessions
    const physicianId = (session as any).physicianId || session.userId;
    
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
      status = 404;
      const res = NextResponse.json(
        { error: "Physician not found" },
        { status }
      );
      logRequestMeta("/api/invitations/send", requestId, status, Date.now() - started);
      return res;
    }

    const physician = physicianResult.rows[0];
    const { rawToken, tokenHash, expiresAt } = createInvitationToken();
    const invitationLink = `${APP_URL}/intake/invite/${rawToken}`;

    const hasUploadedPdf =
      Boolean(labReportFile) || Boolean(previousLabReportFile) || Boolean(formFile);
    let uploadSummaries: InvitationUploadSummaries = {
      labReportSummary: null,
      previousLabReportSummary: null,
      formSummary: null,
    };
    let summaryExpiresAt: Date | null = null;

    if (hasUploadedPdf) {
      try {
        uploadSummaries = await buildInvitationUploadSummaries({
          labReport: labReportFile,
          previousLabReport: previousLabReportFile,
          form: formFile,
        });
        summaryExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
      } catch (summaryError) {
        status = 502;
        const message =
          summaryError instanceof Error ? summaryError.message : "Unable to process uploaded PDF files.";
        const res = NextResponse.json({ error: message }, { status });
        logRequestMeta("/api/invitations/send", requestId, status, Date.now() - started);
        return res;
      }
    }

    // Helper to persist the invitation regardless of delivery method
    const persistInvitation = async () => {
      try {
        const invitationResult = await query<{ id: string }>(
          `INSERT INTO patient_invitations (
             physician_id,
             patient_name,
             patient_email,
             invitation_link,
             token_hash,
             token_expires_at,
             expires_at,
             sent_at,
             patient_background,
             oscar_demographic_no,
             lab_report_summary,
             previous_lab_report_summary,
             form_summary,
             summary_expires_at,
             summary_deleted_at
           )
          VALUES ($1, $2, $3, NULL, $4, $5, $5, NOW(), $6, $7, $8, $9, $10, $11, NULL)
           RETURNING id`,
          [
            physicianId,
            patientName,
            patientEmail.toLowerCase(),
            tokenHash,
            expiresAt,
            patientBackground || null,
            oscarDemographicNo || null,
            uploadSummaries.labReportSummary,
            uploadSummaries.previousLabReportSummary,
            uploadSummaries.formSummary,
            summaryExpiresAt,
          ],
        );
        const invitationId = invitationResult.rows[0]?.id || null;
        if (invitationId) {
          await logInvitationAudit({
            invitationId,
            eventType: "invitation_sent",
            metadata: {
              physicianId,
              patientEmail: patientEmail.toLowerCase(),
              tokenized: true,
              hasPdfSummaries: hasUploadedPdf,
              summaryExpiresAt: summaryExpiresAt ? summaryExpiresAt.toISOString() : null,
            },
          });
        }
      } catch (dbError) {
        console.error("[invitations/send] Failed to persist invitation", dbError);
        logDebug("[invitations/send] DB error details", {
          errorMessage: dbError instanceof Error ? dbError.message : String(dbError),
        });
      }
    };

    // Send email if Resend is configured AND HIPAA mode allows it
    if (resend && process.env.HIPAA_MODE !== "true") {
      try {
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
          to: patientEmail,
          subject: `Patient Intake Form - ${physician.clinic_name}`,
          html: `
            <!DOCTYPE html>
            <html>
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
              </head>
              <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
                  <h1 style="color: #1e293b; margin-bottom: 20px;">Patient Intake Form</h1>
                  
                  <p>Dear ${patientName},</p>
                  
                  <p>You have been invited by <strong>Dr. ${physician.first_name} ${physician.last_name}</strong> from <strong>${physician.clinic_name}</strong> to complete a patient intake form.</p>
                  
                  <p>Please click the button below to access your intake form:</p>
                  
                  <div style="text-align: center; margin: 30px 0;">
                    <a href="${invitationLink}" 
                       style="background-color: #1e293b; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
                      Complete Intake Form
                    </a>
                  </div>
                  
                  <p style="font-size: 14px; color: #64748b;">Or copy and paste this link into your browser:</p>
                  <p style="font-size: 12px; color: #64748b; word-break: break-all;">${invitationLink}</p>
                  
                  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
                  
                  <p style="font-size: 12px; color: #64748b; margin-top: 20px;">
                    This is a secure, HIPAA-compliant patient intake system. Your information will be kept confidential and only shared with your healthcare provider.
                  </p>
                </div>
              </body>
            </html>
          `,
        });

        await persistInvitation();

        const res = NextResponse.json({
          success: true,
          message: "Invitation sent successfully",
          labReportSummary: uploadSummaries.labReportSummary || undefined,
          previousLabReportSummary: uploadSummaries.previousLabReportSummary || undefined,
          formSummary: uploadSummaries.formSummary || undefined,
        });
        logRequestMeta("/api/invitations/send", requestId, status, Date.now() - started);
        return res;
      } catch (emailError) {
        console.error("[invitations/send] Email send failed");
        logDebug("[invitations/send] Email error details", {
          errorMessage: emailError instanceof Error ? emailError.message : String(emailError),
        });
        // Still return success if email fails (for development)
        if (process.env.NODE_ENV === "development") {
          const res = NextResponse.json({
            success: true,
            message: "Invitation link generated (email not sent - check RESEND_API_KEY)",
            invitationLink,
            labReportSummary: uploadSummaries.labReportSummary || undefined,
            previousLabReportSummary: uploadSummaries.previousLabReportSummary || undefined,
            formSummary: uploadSummaries.formSummary || undefined,
          });
          logRequestMeta("/api/invitations/send", requestId, status, Date.now() - started);
          return res;
        }
        status = 500;
        const res = NextResponse.json(
          { error: "Failed to send email" },
          { status }
        );
        logRequestMeta("/api/invitations/send", requestId, status, Date.now() - started);
        return res;
      }
    }

    // HIPAA mode or no email service configured - return the link for manual sharing
    await persistInvitation();
    const res = NextResponse.json({
      success: true,
      hipaaMode: process.env.HIPAA_MODE === "true" ? true : undefined,
      message:
        process.env.HIPAA_MODE === "true"
          ? "Invitation link generated (email sending disabled in HIPAA mode)"
          : "Invitation link generated (email not configured)",
      invitationLink,
      labReportSummary: uploadSummaries.labReportSummary || undefined,
      previousLabReportSummary: uploadSummaries.previousLabReportSummary || undefined,
      formSummary: uploadSummaries.formSummary || undefined,
    });
    logRequestMeta("/api/invitations/send", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[invitations/send] Error handling invitation");
    logDebug("[invitations/send] Error details", {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    status = 500;
    const res = NextResponse.json(
      { error: "Internal server error" },
      { status }
    );
    logRequestMeta("/api/invitations/send", requestId, status, Date.now() - started);
    return res;
  }
}

/**
 * Support both JSON and multipart/form-data (used by the dashboard form with optional files).
 */
async function parseRequestBody(request: NextRequest): Promise<{
  patientName: string;
  patientEmail: string;
  patientBackground: string | null;
  oscarDemographicNo: string | null;
  labReportFile: File | null;
  previousLabReportFile: File | null;
  formFile: File | null;
}> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    return {
      patientName: (formData.get("patientName") as string | null) || "",
      patientEmail: (formData.get("patientEmail") as string | null) || "",
      patientBackground: ((formData.get("patientBackground") as string | null) || "").trim() || null,
      oscarDemographicNo: ((formData.get("oscarDemographicNo") as string | null) || "").trim() || null,
      labReportFile: formData.get("labReport") instanceof File ? (formData.get("labReport") as File) : null,
      previousLabReportFile:
        formData.get("previousLabReport") instanceof File
          ? (formData.get("previousLabReport") as File)
          : null,
      formFile: formData.get("form") instanceof File ? (formData.get("form") as File) : null,
    };
  }

  // Default to JSON
  try {
    const body = await request.json();
    return {
      patientName: (body?.patientName as string) || "",
      patientEmail: (body?.patientEmail as string) || "",
      patientBackground: (body?.patientBackground as string)?.trim() || null,
      oscarDemographicNo: (body?.oscarDemographicNo as string)?.trim() || null,
      labReportFile: null,
      previousLabReportFile: null,
      formFile: null,
    };
  } catch (err) {
    console.error("[invitations/send] Failed to parse JSON body");
    logDebug("[invitations/send] JSON parse error details", {
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return {
      patientName: "",
      patientEmail: "",
      patientBackground: null,
      oscarDemographicNo: null,
      labReportFile: null,
      previousLabReportFile: null,
      formFile: null,
    };
  }
}


