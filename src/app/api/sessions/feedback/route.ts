/**
 * POST /api/sessions/feedback
 * Submit patient experience feedback (star rating + optional comments) for a completed session.
 * No authentication required — patient-facing, rate-limited per session code.
 */

import { NextRequest, NextResponse } from "next/server";
import { storeFeedback } from "@/lib/session-store";
import { consumeDbRateLimit } from "@/lib/rate-limit";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

const FEEDBACK_MAX_ATTEMPTS = 3;
const FEEDBACK_WINDOW_SECONDS = 600; // 10 minutes
const COMMENTS_MAX_LENGTH = 2000;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      status = 400;
      logRequestMeta("/api/sessions/feedback", requestId, status, Date.now() - started);
      return NextResponse.json({ error: "Invalid JSON body" }, { status });
    }

    if (!body || typeof body !== "object") {
      status = 400;
      logRequestMeta("/api/sessions/feedback", requestId, status, Date.now() - started);
      return NextResponse.json({ error: "Missing request body" }, { status });
    }

    const { sessionCode, rating, comments } = body as Record<string, unknown>;

    // Validate sessionCode
    if (typeof sessionCode !== "string" || sessionCode.trim().length === 0) {
      status = 400;
      logRequestMeta("/api/sessions/feedback", requestId, status, Date.now() - started);
      return NextResponse.json({ error: "sessionCode is required" }, { status });
    }
    const code = sessionCode.trim();

    // Validate rating (must be integer 1–5)
    if (
      typeof rating !== "number" ||
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5
    ) {
      status = 400;
      logRequestMeta("/api/sessions/feedback", requestId, status, Date.now() - started);
      return NextResponse.json({ error: "rating must be an integer between 1 and 5" }, { status });
    }

    // Validate comments (optional string, max length)
    const commentsStr =
      typeof comments === "string" ? comments.slice(0, COMMENTS_MAX_LENGTH) : "";

    // Rate limit per session code to prevent abuse
    const rateLimitResult = await consumeDbRateLimit({
      bucketKey: `feedback:${code}`,
      maxAttempts: FEEDBACK_MAX_ATTEMPTS,
      windowSeconds: FEEDBACK_WINDOW_SECONDS,
    });
    if (!rateLimitResult.allowed) {
      status = 429;
      logRequestMeta("/api/sessions/feedback", requestId, status, Date.now() - started);
      return NextResponse.json(
        { error: "Too many feedback attempts. Please try again later." },
        {
          status,
          headers: { "Retry-After": String(rateLimitResult.retryAfterSeconds) },
        },
      );
    }

    // Attempt to store — returns false if feedback was already submitted
    const stored = await storeFeedback(code, rating, commentsStr);
    if (!stored) {
      status = 409;
      logRequestMeta("/api/sessions/feedback", requestId, status, Date.now() - started);
      return NextResponse.json(
        { error: "Feedback has already been submitted for this session." },
        { status },
      );
    }

    logRequestMeta("/api/sessions/feedback", requestId, status, Date.now() - started);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/sessions/feedback] Unexpected error:", error);
    status = 500;
    logRequestMeta("/api/sessions/feedback", requestId, status, Date.now() - started);
    return NextResponse.json({ error: "Internal server error" }, { status });
  }
}
