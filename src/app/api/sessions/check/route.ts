import { NextRequest, NextResponse } from "next/server";
import { patientSessionExists } from "@/lib/session-store";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  const { searchParams } = new URL(request.url);
  const patientEmail = searchParams.get("patientEmail") || "";
  const patientName = searchParams.get("patientName") || "";
  const physicianId = searchParams.get("physicianId") || undefined;

  if (!patientEmail || !patientName) {
    status = 400;
    const res = NextResponse.json(
      { error: "patientEmail and patientName are required" },
      { status },
    );
    logRequestMeta("/api/sessions/check", requestId, status, Date.now() - started);
    return res;
  }

  try {
    const exists = await patientSessionExists({
      patientEmail,
      patientName,
      physicianId,
    });

    const res = NextResponse.json({ exists });
    logRequestMeta("/api/sessions/check", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[sessions-check-route] Error checking patient session existence", { requestId });
    status = 500;
    const res = NextResponse.json(
      { error: "Failed to check session status" },
      { status },
    );
    logRequestMeta("/api/sessions/check", requestId, status, Date.now() - started);
    return res;
  }
}


