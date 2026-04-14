/**
 * GET /api/admin/feedback
 * Returns aggregated patient experience feedback for the super admin dashboard.
 * Requires super_admin session.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "super_admin") {
      status = 401;
      logRequestMeta("/api/admin/feedback", requestId, status, Date.now() - started);
      return NextResponse.json(
        { error: "Unauthorized - Super admin access required" },
        { status },
      );
    }

    // Overall summary
    const summaryResult = await query<{
      total_ratings: string;
      average_rating: string | null;
    }>(
      `SELECT
         COUNT(*) AS total_ratings,
         ROUND(AVG(feedback_rating)::numeric, 1)::text AS average_rating
       FROM patient_sessions
       WHERE feedback_submitted_at IS NOT NULL`,
    );

    const summaryRow = summaryResult.rows[0];
    const totalRatings = parseInt(summaryRow?.total_ratings ?? "0", 10);
    const averageRating = summaryRow?.average_rating
      ? parseFloat(summaryRow.average_rating)
      : null;

    // Per-organisation aggregates
    const byOrgResult = await query<{
      organization_id: string;
      organization_name: string;
      count: string;
      average: string;
    }>(
      `SELECT
         o.id            AS organization_id,
         o.name          AS organization_name,
         COUNT(ps.id)    AS count,
         ROUND(AVG(ps.feedback_rating)::numeric, 1)::text AS average
       FROM patient_sessions ps
       JOIN physicians ph ON ph.id = ps.physician_id
       JOIN organizations o ON o.id = ph.organization_id
       WHERE ps.feedback_submitted_at IS NOT NULL
       GROUP BY o.id, o.name
       ORDER BY o.name ASC`,
    );

    const byOrganization = byOrgResult.rows.map((row) => ({
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      count: parseInt(row.count, 10),
      average: parseFloat(row.average),
    }));

    // Recent individual feedback (last 20), most recent first
    const recentResult = await query<{
      organization_name: string;
      physician_name: string;
      rating: number;
      comments: string | null;
      submitted_at: Date;
    }>(
      `SELECT
         o.name                                  AS organization_name,
         COALESCE(ph.first_name || ' ' || ph.last_name, ph.username) AS physician_name,
         ps.feedback_rating                      AS rating,
         ps.feedback_comments                    AS comments,
         ps.feedback_submitted_at                AS submitted_at
       FROM patient_sessions ps
       JOIN physicians ph ON ph.id = ps.physician_id
       LEFT JOIN organizations o ON o.id = ph.organization_id
       WHERE ps.feedback_submitted_at IS NOT NULL
       ORDER BY ps.feedback_submitted_at DESC
       LIMIT 20`,
    );

    const recentFeedback = recentResult.rows.map((row) => ({
      organizationName: row.organization_name ?? "Independent",
      physicianName: row.physician_name,
      rating: row.rating,
      comments: row.comments ?? null,
      submittedAt: row.submitted_at,
    }));

    logRequestMeta("/api/admin/feedback", requestId, status, Date.now() - started);
    return NextResponse.json({
      summary: { totalRatings, averageRating },
      byOrganization,
      recentFeedback,
    });
  } catch (error) {
    console.error("[api/admin/feedback] Unexpected error:", error);
    status = 500;
    logRequestMeta("/api/admin/feedback", requestId, status, Date.now() - started);
    return NextResponse.json({ error: "Internal server error" }, { status });
  }
}
