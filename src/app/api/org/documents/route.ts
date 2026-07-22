/**
 * GET /api/org/documents
 * Lists this org's patient document requests, each with its uploaded files.
 * File bytes are never returned here — only metadata + a file id the client
 * uses against /api/org/documents/files/[fileId] to open a signed URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

interface FileRow {
  id: string;
  request_id: string;
  original_filename: string | null;
  content_type: string | null;
  size_bytes: string | null;
  uploaded_at: string;
}

interface RequestRow {
  id: string;
  patient_name: string;
  patient_email: string;
  expires_at: string;
  revoked_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "org_admin" || !session.organizationId) {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/org/documents", requestId, status, Date.now() - started);
      return res;
    }

    const requestsResult = await query<RequestRow>(
      `SELECT id, patient_name, patient_email, expires_at, revoked_at, completed_at, created_at
       FROM patient_document_requests
       WHERE organization_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [session.organizationId],
    );

    const requestIds = requestsResult.rows.map((r) => r.id);
    const filesByRequest = new Map<string, FileRow[]>();

    if (requestIds.length) {
      const filesResult = await query<FileRow>(
        `SELECT id, request_id, original_filename, content_type, size_bytes, uploaded_at
         FROM patient_document_files
         WHERE request_id = ANY($1::uuid[]) AND deleted_at IS NULL
         ORDER BY uploaded_at ASC`,
        [requestIds],
      );
      for (const f of filesResult.rows) {
        const list = filesByRequest.get(f.request_id) ?? [];
        list.push(f);
        filesByRequest.set(f.request_id, list);
      }
    }

    const now = Date.now();
    const requests = requestsResult.rows.map((r) => {
      const files = filesByRequest.get(r.id) ?? [];
      let statusLabel: "completed" | "revoked" | "expired" | "pending";
      if (r.completed_at || files.length > 0) statusLabel = "completed";
      else if (r.revoked_at) statusLabel = "revoked";
      else if (new Date(r.expires_at).getTime() < now) statusLabel = "expired";
      else statusLabel = "pending";

      return {
        id: r.id,
        patientName: r.patient_name,
        patientEmail: r.patient_email,
        status: statusLabel,
        expiresAt: r.expires_at,
        completedAt: r.completed_at,
        createdAt: r.created_at,
        files: files.map((f) => ({
          id: f.id,
          filename: f.original_filename,
          contentType: f.content_type,
          sizeBytes: f.size_bytes ? Number(f.size_bytes) : null,
          uploadedAt: f.uploaded_at,
        })),
      };
    });

    const res = NextResponse.json({ requests });
    logRequestMeta("/api/org/documents", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/org/documents] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/org/documents", requestId, status, Date.now() - started);
    return res;
  }
}
