/**
 * GET/PUT /api/physician/interview-guidance
 * Get or update physician's interview guidance
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
    if (!session) {
      status = 401;
      const res = NextResponse.json(
        { error: "Authentication required" },
        { status }
      );
      logRequestMeta("/api/physician/interview-guidance", requestId, status, Date.now() - started);
      return res;
    }

    if (session.userType !== "provider") {
      status = 403;
      const res = NextResponse.json(
        { error: "Only providers can access interview guidance" },
        { status }
      );
      logRequestMeta("/api/physician/interview-guidance", requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = (session as any).physicianId || session.userId;

    const result = await query<{ interview_guidance: string | null }>(
      `SELECT interview_guidance
       FROM physicians
       WHERE id = $1`,
      [physicianId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Physician not found" },
        { status: 404 }
      );
    }

    const res = NextResponse.json({
      interviewGuidance: result.rows[0].interview_guidance || "",
    });
    logRequestMeta("/api/physician/interview-guidance", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[physician/interview-guidance] Error");
    const res = NextResponse.json(
      { error: "Internal server error" },
      { status }
    );
    logRequestMeta("/api/physician/interview-guidance", requestId, status, Date.now() - started);
    return res;
  }
}

export async function PUT(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const session = await getCurrentSession();
    if (!session) {
      status = 401;
      const res = NextResponse.json(
        { error: "Authentication required" },
        { status }
      );
      logRequestMeta("/api/physician/interview-guidance", requestId, status, Date.now() - started);
      return res;
    }

    if (session.userType !== "provider") {
      status = 403;
      const res = NextResponse.json(
        { error: "Only providers can update interview guidance" },
        { status }
      );
      logRequestMeta("/api/physician/interview-guidance", requestId, status, Date.now() - started);
      return res;
    }

    const body = await request.json();
    const { interviewGuidance } = body;

    if (typeof interviewGuidance !== "string") {
      status = 400;
      const res = NextResponse.json(
        { error: "interviewGuidance must be a string" },
        { status }
      );
      logRequestMeta("/api/physician/interview-guidance", requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = (session as any).physicianId || session.userId;

    await query(
      `UPDATE physicians
       SET interview_guidance = $1
       WHERE id = $2`,
      [interviewGuidance || null, physicianId]
    );

    const res = NextResponse.json({
      success: true,
      message: "Interview guidance updated successfully",
    });
    logRequestMeta("/api/physician/interview-guidance", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[physician/interview-guidance] Error");
    const res = NextResponse.json(
      { error: "Internal server error" },
      { status }
    );
    logRequestMeta("/api/physician/interview-guidance", requestId, status, Date.now() - started);
    return res;
  }
}


