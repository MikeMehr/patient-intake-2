import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getLabEditorSession } from "@/lib/lab-requisition-editor-session";
import { renderLabRequisitionPdf } from "@/lib/lab-requisition-renderer";
import { query } from "@/lib/db";
import type { LabRequisitionPrefillPayload } from "@/lib/lab-requisition-payload";

export const runtime = "nodejs";

function normalizeText(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function buildPatientName(fields: Record<string, string | boolean>, fallback: string): string {
  const first = normalizeText(fields.FirstName);
  const last = normalizeText(fields.Surname);
  const full = `${first} ${last}`.trim();
  return full || fallback;
}

function selectedLabFields(fields: Record<string, string | boolean>): string[] {
  const selected: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === true || value === "X") {
      selected.push(key);
    }
  }
  return selected;
}

function respond(path: string, requestId: string, started: number, status: number, body: Record<string, unknown>) {
  const res = NextResponse.json(body, { status });
  logRequestMeta(path, requestId, status, Date.now() - started);
  return res;
}

function resolveRequestOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") || "https";
  if (host) return `${protocol}://${host}`;
  return new URL(request.url).origin;
}

function getFormUrlCandidates(origin: string): string[] {
  const configured = (process.env.LAB_REQUISITION_EFORM_URL || "").trim();
  const fallback = `${origin}/eforms/1.1LabRequisition/1.1LabRequisition.html`;
  const urls = [configured, fallback].filter(Boolean);
  return Array.from(new Set(urls));
}

function normalizeInstructionLine(line: string): string {
  return line
    .trim()
    .replace(/^(notes:\s*)+/i, "")
    .replace(/^requested tests \(manual entry\):\s*/i, "")
    .trim();
}

function combineUniqueTextBlocks(values: string[]): string {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const lines = value
      .split("\n")
      .map((line) => normalizeInstructionLine(line))
      .filter(Boolean);
    for (const line of lines) {
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push(line);
    }
  }
  return ordered.join("\n");
}

function escapePdfText(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildFallbackPdf(lines: string[]): Buffer {
  const sanitized = lines
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .slice(0, 6);
  const textOps = sanitized
    .map((line, index) => {
      const escaped = escapePdfText(line);
      return index === 0 ? `(${escaped}) Tj` : `T* (${escaped}) Tj`;
    })
    .join("\n");
  const streamText = `BT
/F1 12 Tf
72 730 Td
14 TL
${textOps || "(Lab requisition saved.) Tj"}
ET`;
  const stream = `<< /Length ${Buffer.byteLength(streamText, "utf8")} >>\nstream\n${streamText}\nendstream`;

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    stream,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let output = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(output, "utf8"));
    output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(output, "utf8");
  output += `xref
0 ${objects.length + 1}
0000000000 65535 f 
`;
  for (let i = 1; i < offsets.length; i += 1) {
    output += `${String(offsets[i]).padStart(10, "0")} 00000 n 
`;
  }
  output += `trailer
<< /Size ${objects.length + 1} /Root 1 0 R >>
startxref
${xrefOffset}
%%EOF`;

  return Buffer.from(output, "utf8");
}

function isPdfRenderDependencyFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  const lowered = message.toLowerCase();
  return (
    lowered.includes("libnspr4.so") ||
    lowered.includes("browsertype.launch") ||
    lowered.includes("chromium runtime is unavailable") ||
    lowered.includes("failed to launch browser")
  );
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body?.token === "string" ? body.token : "";
    const fields = body?.fields && typeof body.fields === "object" ? body.fields : null;

    if (!token || !fields) {
      return respond("/api/lab-requisitions/editor-save", requestId, started, 400, {
        error: "token and fields are required.",
      });
    }

    const auth = await getCurrentSession();
    if (!auth) {
      return respond("/api/lab-requisitions/editor-save", requestId, started, 401, {
        error: "Authentication required.",
      });
    }
    if (auth.userType !== "provider") {
      return respond("/api/lab-requisitions/editor-save", requestId, started, 403, {
        error: "Only providers can save requisitions.",
      });
    }

    const editorSession = await getLabEditorSession(token, auth.userId);
    if (!editorSession) {
      return respond("/api/lab-requisitions/editor-save", requestId, started, 404, {
        error: "Editor session not found or expired.",
      });
    }

    const payload = (editorSession.payload_json || {}) as LabRequisitionPrefillPayload;
    payload.editorFields = fields as Record<string, string | boolean>;

    const origin = resolveRequestOrigin(request);
    const formUrls = getFormUrlCandidates(origin);
    let pdfBuffer: Buffer | null = null;
    let lastError: unknown = null;
    let sawDependencyFailure = false;
    for (const formUrl of formUrls) {
      try {
        pdfBuffer = await renderLabRequisitionPdf({ formUrl, payload });
        break;
      } catch (error) {
        lastError = error;
        sawDependencyFailure = sawDependencyFailure || isPdfRenderDependencyFailure(error);
        console.error("[lab-requisitions/editor-save] PDF render failed for URL:", formUrl, error);
      }
    }
    if (!pdfBuffer) {
      if (!sawDependencyFailure) {
        throw lastError instanceof Error
          ? lastError
          : new Error("Failed to render lab requisition PDF.");
      }
      pdfBuffer = buildFallbackPdf([
        "Lab requisition saved (fallback PDF).",
        "Automated rendering is temporarily unavailable on this server.",
        "Please open the requisition in the browser to print the full form.",
      ]);
    }

    const normalizedFields = fields as Record<string, string | boolean>;
    const patientName = buildPatientName(normalizedFields, payload.patient?.fullName || "Unknown");
    const patientEmail = payload.patient?.email || "";
    const physicianName = normalizeText(normalizedFields.CurrentProviderDoctor) || payload.provider?.name || null;
    const clinicLabel = normalizeText(normalizedFields.clinic_label);
    const clinicLabelLines = clinicLabel.split("\n").map((line) => line.trim()).filter(Boolean);
    const clinicName = clinicLabelLines[0] || payload.provider?.clinic || null;
    const clinicAddress =
      clinicLabelLines.slice(1).join(", ") || payload.provider?.clinicAddress || null;
    const selectedLabs = selectedLabFields(normalizedFields);
    const labs =
      payload.order?.testsDisplay && payload.order.testsDisplay.length > 0
        ? payload.order.testsDisplay
        : selectedLabs;
    const additionalInstructionsField = normalizeText(normalizedFields.AdditionalTestInstructions);
    const legacyCurrentMedsField = normalizeText(normalizedFields.CurrentMedicationsLastDose);
    const additionalInstructions = combineUniqueTextBlocks([
      additionalInstructionsField,
      normalizeText(payload.order?.additionalInstructions),
      additionalInstructionsField ? "" : legacyCurrentMedsField,
    ]);

    const insert = await query<{ id: string; created_at: Date }>(
      `INSERT INTO lab_requisitions (
        session_code, patient_name, patient_email,
        physician_name, clinic_name, clinic_address,
        labs, additional_instructions, pdf_bytes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id, created_at`,
      [
        editorSession.session_code,
        patientName,
        patientEmail,
        physicianName,
        clinicName,
        clinicAddress,
        JSON.stringify(labs),
        additionalInstructions || null,
        pdfBuffer,
      ],
    );
    const created = insert.rows[0];

    return respond("/api/lab-requisitions/editor-save", requestId, started, 200, {
      success: true,
      requisitionId: created.id,
      createdAt: created.created_at,
      pdfBase64: sawDependencyFailure ? null : pdfBuffer.toString("base64"),
      fileName: `lab-requisition-${created.id}.pdf`,
      downloadUrl: sawDependencyFailure
        ? null
        : `/api/lab-requisitions?code=${encodeURIComponent(editorSession.session_code)}&id=${created.id}`,
      warning: sawDependencyFailure
        ? "Saved with fallback PDF because server-side browser rendering is unavailable."
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lowered = message.toLowerCase();
    const isDbConnectionError =
      lowered.includes("connection terminated unexpectedly") ||
      lowered.includes("connection terminated due to connection timeout") ||
      lowered.includes("read etimedout") ||
      lowered.includes("econnreset");

    console.error("[lab-requisitions/editor-save] Unhandled error", error);
    return respond("/api/lab-requisitions/editor-save", requestId, started, 500, {
      error: isDbConnectionError
        ? "Database connection timed out while saving. Please try again."
        : "Failed to save lab requisition.",
      details: process.env.NODE_ENV === "development" ? message : undefined,
    });
  }
}

