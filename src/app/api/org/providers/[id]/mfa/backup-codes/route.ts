import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { generateBackupCodes, getBackupCodeStatus } from "@/lib/auth-mfa";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "org_admin" || !session.organizationId) {
      status = 401;
      const res = NextResponse.json(
        { error: "Unauthorized - Organization admin access required" },
        { status },
      );
      logRequestMeta("/api/org/providers/[id]/mfa/backup-codes", requestId, status, Date.now() - started);
      return res;
    }

    const { id } = await params;
    const providerResult = await query<{ id: string }>(
      `SELECT id
       FROM physicians
       WHERE id = $1
         AND organization_id = $2`,
      [id, session.organizationId],
    );
    if (providerResult.rows.length === 0) {
      status = 404;
      const res = NextResponse.json({ error: "Provider not found or access denied" }, { status });
      logRequestMeta("/api/org/providers/[id]/mfa/backup-codes", requestId, status, Date.now() - started);
      return res;
    }

    const backupCodes = await getBackupCodeStatus({
      userType: "provider",
      userId: id,
    });
    const res = NextResponse.json({ backupCodes });
    logRequestMeta("/api/org/providers/[id]/mfa/backup-codes", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[org/providers/[id]/mfa/backup-codes] GET Error", error);
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/org/providers/[id]/mfa/backup-codes", requestId, status, Date.now() - started);
    return res;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "org_admin" || !session.organizationId) {
      status = 401;
      const res = NextResponse.json(
        { error: "Unauthorized - Organization admin access required" },
        { status },
      );
      logRequestMeta("/api/org/providers/[id]/mfa/backup-codes", requestId, status, Date.now() - started);
      return res;
    }

    const { id } = await params;
    const providerResult = await query<{ id: string }>(
      `SELECT id
       FROM physicians
       WHERE id = $1
         AND organization_id = $2`,
      [id, session.organizationId],
    );
    if (providerResult.rows.length === 0) {
      status = 404;
      const res = NextResponse.json({ error: "Provider not found or access denied" }, { status });
      logRequestMeta("/api/org/providers/[id]/mfa/backup-codes", requestId, status, Date.now() - started);
      return res;
    }

    const body = (await request.json().catch(() => ({}))) as { action?: "generate" | "rotate" };
    const action = body.action || "generate";

    try {
      const generated = await generateBackupCodes({
        userType: "provider",
        userId: id,
        rotateExisting: action === "rotate",
      });
      const res = NextResponse.json({
        backupCodes: generated.codes,
        status: {
          activeCodes: generated.activeCodes,
          lastGeneratedAt: generated.lastGeneratedAt,
        },
      });
      logRequestMeta("/api/org/providers/[id]/mfa/backup-codes", requestId, status, Date.now() - started);
      return res;
    } catch (error) {
      if (error instanceof Error && error.message === "ACTIVE_CODES_EXIST") {
        status = 409;
        const res = NextResponse.json(
          { error: "Active backup codes already exist. Rotate codes to replace them." },
          { status },
        );
        logRequestMeta("/api/org/providers/[id]/mfa/backup-codes", requestId, status, Date.now() - started);
        return res;
      }
      throw error;
    }
  } catch (error) {
    status = 500;
    console.error("[org/providers/[id]/mfa/backup-codes] POST Error", error);
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/org/providers/[id]/mfa/backup-codes", requestId, status, Date.now() - started);
    return res;
  }
}
