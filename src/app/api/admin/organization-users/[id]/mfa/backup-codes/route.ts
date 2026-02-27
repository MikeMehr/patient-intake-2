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
    if (!session || session.userType !== "super_admin") {
      status = 401;
      const res = NextResponse.json(
        { error: "Unauthorized - Super admin access required" },
        { status },
      );
      logRequestMeta("/api/admin/organization-users/[id]/mfa/backup-codes", requestId, status, Date.now() - started);
      return res;
    }
    const { id } = await params;
    const existing = await query<{ id: string }>(
      `SELECT id FROM organization_users WHERE id = $1`,
      [id],
    );
    if (existing.rows.length === 0) {
      status = 404;
      const res = NextResponse.json({ error: "Organization admin not found" }, { status });
      logRequestMeta("/api/admin/organization-users/[id]/mfa/backup-codes", requestId, status, Date.now() - started);
      return res;
    }

    const backupCodes = await getBackupCodeStatus({ userType: "org_admin", userId: id });
    const res = NextResponse.json({ backupCodes });
    logRequestMeta("/api/admin/organization-users/[id]/mfa/backup-codes", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[admin/organization-users/[id]/mfa/backup-codes] GET Error", error);
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/admin/organization-users/[id]/mfa/backup-codes", requestId, status, Date.now() - started);
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
    if (!session || session.userType !== "super_admin") {
      status = 401;
      const res = NextResponse.json(
        { error: "Unauthorized - Super admin access required" },
        { status },
      );
      logRequestMeta("/api/admin/organization-users/[id]/mfa/backup-codes", requestId, status, Date.now() - started);
      return res;
    }
    const { id } = await params;
    const existing = await query<{ id: string }>(
      `SELECT id FROM organization_users WHERE id = $1`,
      [id],
    );
    if (existing.rows.length === 0) {
      status = 404;
      const res = NextResponse.json({ error: "Organization admin not found" }, { status });
      logRequestMeta("/api/admin/organization-users/[id]/mfa/backup-codes", requestId, status, Date.now() - started);
      return res;
    }
    const body = (await request.json().catch(() => ({}))) as { action?: "generate" | "rotate" };
    const action = body.action || "generate";

    try {
      const generated = await generateBackupCodes({
        userType: "org_admin",
        userId: id,
        rotateExisting: action === "rotate",
      });
      const res = NextResponse.json({
        backupCodes: generated.codes,
        status: {
          activeCodes: generated.activeCodes,
          lastGeneratedAt: generated.lastGeneratedAt,
          recoveryVersion: generated.recoveryVersion,
          backupCodesRequired: generated.backupCodesRequired,
        },
      });
      logRequestMeta("/api/admin/organization-users/[id]/mfa/backup-codes", requestId, status, Date.now() - started);
      return res;
    } catch (error) {
      if (error instanceof Error && error.message === "ACTIVE_CODES_EXIST") {
        status = 409;
        const res = NextResponse.json(
          { error: "Active backup codes already exist. Rotate codes to replace them." },
          { status },
        );
        logRequestMeta("/api/admin/organization-users/[id]/mfa/backup-codes", requestId, status, Date.now() - started);
        return res;
      }
      throw error;
    }
  } catch (error) {
    status = 500;
    console.error("[admin/organization-users/[id]/mfa/backup-codes] POST Error", error);
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/admin/organization-users/[id]/mfa/backup-codes", requestId, status, Date.now() - started);
    return res;
  }
}
