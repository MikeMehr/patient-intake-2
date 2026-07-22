/**
 * Public (token-authenticated) patient document upload.
 *   GET  /api/uploads/[token]  → validity + patient/clinic name for the page
 *   POST /api/uploads/[token]  → accept files (multipart), store to Azure Blob
 *
 * No login: the unguessable token IS the credential. Validate strictly.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { query } from "@/lib/db";
import { hashDocumentToken } from "@/lib/document-token";
import { uploadDocumentBlob } from "@/lib/azure-blob-documents";
import { consumeRateLimit } from "@/lib/invitation-security";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB each
const ALLOWED_PREFIXES = ["image/"];
const ALLOWED_EXACT = ["application/pdf"];

interface RequestRow {
  id: string;
  organization_id: string;
  patient_name: string;
  expires_at: string;
  revoked_at: string | null;
  completed_at: string | null;
}

async function loadRequest(rawToken: string): Promise<RequestRow | null> {
  const hash = hashDocumentToken(rawToken);
  const result = await query<RequestRow>(
    `SELECT id, organization_id, patient_name, expires_at, revoked_at, completed_at
     FROM patient_document_requests
     WHERE token_hash = $1`,
    [hash],
  );
  return result.rows[0] ?? null;
}

function requestState(req: RequestRow): "valid" | "revoked" | "expired" | "completed" {
  if (req.revoked_at) return "revoked";
  if (req.completed_at) return "completed";
  if (new Date(req.expires_at).getTime() < Date.now()) return "expired";
  return "valid";
}

function isAllowedType(type: string): boolean {
  const t = (type || "").toLowerCase();
  return ALLOWED_PREFIXES.some((p) => t.startsWith(p)) || ALLOWED_EXACT.includes(t);
}

function sanitizeFilename(name: string): string {
  return (name || "file")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 120);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  const { token } = await params;

  try {
    const req = await loadRequest(token);
    if (!req) {
      logRequestMeta("/api/uploads", requestId, 404, Date.now() - started);
      return NextResponse.json({ valid: false, reason: "not_found" }, { status: 404 });
    }

    const orgResult = await query<{ name: string }>(
      `SELECT name FROM organizations WHERE id = $1`,
      [req.organization_id],
    );

    const state = requestState(req);
    logRequestMeta("/api/uploads", requestId, 200, Date.now() - started);
    return NextResponse.json({
      valid: state === "valid",
      state,
      patientName: req.patient_name,
      clinicName: orgResult.rows[0]?.name ?? "the clinic",
    });
  } catch (error) {
    console.error("[api/uploads GET] Error:", error);
    logRequestMeta("/api/uploads", requestId, 500, Date.now() - started);
    return NextResponse.json({ valid: false, reason: "error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  const { token } = await params;

  try {
    const req = await loadRequest(token);
    if (!req) {
      logRequestMeta("/api/uploads", requestId, 404, Date.now() - started);
      return NextResponse.json({ error: "This upload link is not valid." }, { status: 404 });
    }

    const state = requestState(req);
    if (state !== "valid") {
      const message =
        state === "expired"
          ? "This upload link has expired. Please contact the clinic for a new one."
          : state === "completed"
            ? "Documents have already been submitted for this request."
            : "This upload link is no longer active.";
      logRequestMeta("/api/uploads", requestId, 410, Date.now() - started);
      return NextResponse.json({ error: message }, { status: 410 });
    }

    const rl = await consumeRateLimit(`uploads:${hashDocumentToken(token)}`, 20, 600);
    if (!rl.allowed) {
      logRequestMeta("/api/uploads", requestId, 429, Date.now() - started);
      return NextResponse.json(
        { error: "Too many attempts. Please try again in a few minutes." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      logRequestMeta("/api/uploads", requestId, 400, Date.now() - started);
      return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
    }

    const files = (formData.getAll("files") as File[]).filter((f) => f && f.size > 0);
    if (!files.length) {
      logRequestMeta("/api/uploads", requestId, 400, Date.now() - started);
      return NextResponse.json({ error: "Please choose at least one file." }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      logRequestMeta("/api/uploads", requestId, 400, Date.now() - started);
      return NextResponse.json(
        { error: `You can upload at most ${MAX_FILES} files.` },
        { status: 400 },
      );
    }

    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        logRequestMeta("/api/uploads", requestId, 400, Date.now() - started);
        return NextResponse.json(
          { error: `"${file.name}" is larger than the 10 MB limit.` },
          { status: 400 },
        );
      }
      if (!isAllowedType(file.type)) {
        logRequestMeta("/api/uploads", requestId, 400, Date.now() - started);
        return NextResponse.json(
          { error: `"${file.name}" is not an image or PDF.` },
          { status: 400 },
        );
      }
    }

    let stored = 0;
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const blobPath = `${req.organization_id}/${req.id}/${randomBytes(8).toString("hex")}-${sanitizeFilename(file.name)}`;
      await uploadDocumentBlob({
        blobName: blobPath,
        buffer,
        contentType: file.type || "application/octet-stream",
      });
      await query(
        `INSERT INTO patient_document_files
           (request_id, blob_path, original_filename, content_type, size_bytes)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.id, blobPath, file.name, file.type || null, file.size],
      );
      stored += 1;
    }

    await query(
      `UPDATE patient_document_requests SET completed_at = NOW() WHERE id = $1`,
      [req.id],
    );

    logRequestMeta("/api/uploads", requestId, 200, Date.now() - started);
    return NextResponse.json({ success: true, count: stored });
  } catch (error) {
    console.error("[api/uploads POST] Error:", error);
    logRequestMeta("/api/uploads", requestId, 500, Date.now() - started);
    return NextResponse.json(
      { error: "Something went wrong while uploading. Please try again." },
      { status: 500 },
    );
  }
}
