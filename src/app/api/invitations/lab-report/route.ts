/**
 * GET /api/invitations/lab-report
 * Get lab report summary for a patient invitation
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { logDebug } from "@/lib/secure-logger";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const searchParams = request.nextUrl.searchParams;
    const physicianId = searchParams.get("physicianId");
    const patientEmail = searchParams.get("patientEmail");

    if (!physicianId || !patientEmail) {
      status = 400;
      const res = NextResponse.json(
        { error: "Physician ID and patient email are required" },
        { status }
      );
      logRequestMeta("/api/invitations/lab-report", requestId, status, Date.now() - started);
      return res;
    }

    // Get the most recent invitation for this physician and patient email
    try {
      logDebug("[invitations/lab-report] Querying", { physicianId, patientEmail });
      
      let result:
        | {
            rows: Array<{
              lab_report_summary: string | null;
              previous_lab_report_summary: string | null;
              form_summary: string | null;
              patient_background?: string | null;
            }>;
          }
        | undefined;

      try {
        // Preferred query when the patient_background column exists.
        result = await query(
          `SELECT lab_report_summary, previous_lab_report_summary, form_summary, patient_background
           FROM patient_invitations
           WHERE physician_id = $1 AND patient_email = $2
           ORDER BY sent_at DESC
           LIMIT 1`,
          [physicianId, patientEmail],
        );
      } catch (err: any) {
        // Fallback for databases that have not yet added patient_background.
        if (err?.code === "42703") {
          result = await query(
            `SELECT lab_report_summary, previous_lab_report_summary, form_summary
             FROM patient_invitations
             WHERE physician_id = $1 AND patient_email = $2
             ORDER BY sent_at DESC
             LIMIT 1`,
            [physicianId, patientEmail],
          );
        } else {
          throw err;
        }
      }

      logDebug("[invitations/lab-report] Query result rows", { rows: result.rows.length });
      
      if (result.rows.length === 0) {
        logDebug("[invitations/lab-report] No invitation found");
        const res = NextResponse.json(
          { labReportSummary: null, previousLabReportSummary: null, formSummary: null },
          { status }
        );
        logRequestMeta("/api/invitations/lab-report", requestId, status, Date.now() - started);
        return res;
      }

      const labReportSummary = result.rows[0].lab_report_summary;
      const previousLabReportSummary = result.rows[0].previous_lab_report_summary;
      const formSummary = result.rows[0].form_summary;
      const patientBackground = (result.rows[0] as any).patient_background ?? null;
      logDebug("[invitations/lab-report] Found summaries", {
        labReportSummary: labReportSummary ? labReportSummary.length : 0,
        previousLabReportSummary: previousLabReportSummary ? previousLabReportSummary.length : 0,
        formSummary: formSummary ? formSummary.length : 0,
      });
      
      const res = NextResponse.json({
        labReportSummary: labReportSummary || null,
        previousLabReportSummary: previousLabReportSummary || null,
        formSummary: formSummary || null,
        patientBackground: patientBackground || null,
      });
      logRequestMeta("/api/invitations/lab-report", requestId, status, Date.now() - started);
      return res;
    } catch (dbError: any) {
      // If table doesn't exist, return null instead of error
      if (dbError?.code === '42P01') {
        logDebug("[invitations/lab-report] patient_invitations table missing");
        const res = NextResponse.json(
          { labReportSummary: null, previousLabReportSummary: null, formSummary: null },
          { status }
        );
        logRequestMeta("/api/invitations/lab-report", requestId, status, Date.now() - started);
        return res;
      }
      throw dbError;
    }
  } catch (error) {
    status = 500;
    console.error("[invitations/lab-report] Error");
    const res = NextResponse.json(
      { error: "Internal server error" },
      { status }
    );
    logRequestMeta("/api/invitations/lab-report", requestId, status, Date.now() - started);
    return res;
  }
}


