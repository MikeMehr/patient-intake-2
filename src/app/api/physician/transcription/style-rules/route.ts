import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getRequestIp } from "@/lib/invitation-security";
import { resolveWorkforceScope } from "@/lib/transcription-store";
import { logPhysicianPhiAudit } from "@/lib/phi-audit";
import { deleteStyleRule, listStyleRules } from "@/lib/ai-style-rules";

const ROUTE = "/api/physician/transcription/style-rules";

type AuthResult =
  | { ok: true; physicianId: string }
  | { ok: false; response: NextResponse; status: number };

async function requireProvider(requestId: string, started: number): Promise<AuthResult> {
  const auth = await getCurrentSession();
  if (!auth) {
    const status = 401;
    const response = NextResponse.json({ error: "Authentication required." }, { status });
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return { ok: false, response, status };
  }
  const physicianId = getEffectivePhysicianId(auth);
  const scope =
    auth.userType === "provider"
      ? resolveWorkforceScope({
          userType: auth.userType,
          userId: physicianId,
          organizationId: auth.organizationId || null,
        })
      : null;
  if (auth.userType !== "provider" || !scope) {
    const status = 403;
    const response = NextResponse.json({ error: "Provider access required." }, { status });
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return { ok: false, response, status };
  }
  return { ok: true, physicianId };
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  try {
    const auth = await requireProvider(requestId, started);
    if (!auth.ok) return auth.response;

    const rules = await listStyleRules(auth.physicianId);
    const res = NextResponse.json({ rules });
    logRequestMeta(ROUTE, requestId, 200, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[physician/transcription/style-rules] GET failed:", error);
    const res = NextResponse.json({ error: "Failed to load learned preferences." }, { status: 500 });
    logRequestMeta(ROUTE, requestId, 500, Date.now() - started);
    return res;
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  try {
    const auth = await requireProvider(requestId, started);
    if (!auth.ok) return auth.response;

    const idParse = z.string().uuid().safeParse(request.nextUrl.searchParams.get("id"));
    if (!idParse.success) {
      const res = NextResponse.json({ error: "Invalid rule id." }, { status: 400 });
      logRequestMeta(ROUTE, requestId, 400, Date.now() - started);
      return res;
    }

    const deleted = await deleteStyleRule(auth.physicianId, idParse.data);
    if (!deleted) {
      const res = NextResponse.json({ error: "Preference not found." }, { status: 404 });
      logRequestMeta(ROUTE, requestId, 404, Date.now() - started);
      return res;
    }

    await logPhysicianPhiAudit({
      physicianId: auth.physicianId,
      eventType: "transcription_style_rule_deleted",
      ipAddress: getRequestIp(request.headers),
      userAgent: request.headers.get("user-agent"),
      metadata: { requestId, ruleId: idParse.data },
    });

    const res = NextResponse.json({ ok: true });
    logRequestMeta(ROUTE, requestId, 200, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[physician/transcription/style-rules] DELETE failed:", error);
    const res = NextResponse.json({ error: "Failed to delete preference." }, { status: 500 });
    logRequestMeta(ROUTE, requestId, 500, Date.now() - started);
    return res;
  }
}
