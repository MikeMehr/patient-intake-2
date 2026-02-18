import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getSession } from "@/lib/session-store";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { createLabEditorSession, getLabEditorSession } from "@/lib/lab-requisition-editor-session";
import { mapLabTestsToEformFields } from "@/lib/lab-requisition-mapping";
import { buildLabRequisitionPrefillPayload } from "@/lib/lab-requisition-payload";

export const runtime = "nodejs";

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

function buildLabEditorUrl(args: { requestOrigin: string; editorToken: string }): string {
  const configured = (process.env.LAB_REQUISITION_EFORM_URL || "").trim();
  const fallback = `${args.requestOrigin}/eforms/1.1LabRequisition/1.1LabRequisition.html`;
  const base = configured || fallback;
  try {
    const url = new URL(base);
    url.searchParams.set("editorToken", args.editorToken);
    return url.toString();
  } catch {
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}editorToken=${encodeURIComponent(args.editorToken)}`;
  }
}

function sanitizeAdditionalInstructions(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^(notes:\s*)+/i, "")
        .replace(/^requested tests \(manual entry\):\s*/i, "")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

function combineUniqueInstructionLines(parts: string[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const part of parts) {
    const sanitized = sanitizeAdditionalInstructions(part);
    if (!sanitized) continue;
    for (const line of sanitized.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(trimmed);
    }
  }
  return lines.join("\n");
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return respond("/api/lab-requisitions/editor-session", requestId, started, 400, {
      error: "token is required.",
    });
  }

  const auth = await getCurrentSession();
  if (!auth) {
    return respond("/api/lab-requisitions/editor-session", requestId, started, 401, {
      error: "Authentication required.",
    });
  }
  if (auth.userType !== "provider") {
    return respond("/api/lab-requisitions/editor-session", requestId, started, 403, {
      error: "Only providers can open editor sessions.",
    });
  }

  const editorSession = await getLabEditorSession(token, auth.userId);
  if (!editorSession) {
    return respond("/api/lab-requisitions/editor-session", requestId, started, 404, {
      error: "Editor session not found or expired.",
    });
  }

  return respond("/api/lab-requisitions/editor-session", requestId, started, 200, {
    token: editorSession.token,
    sessionCode: editorSession.session_code,
    payload: editorSession.payload_json,
  });
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  const body = await request.json().catch(() => ({}));
  const sessionCode = typeof body?.sessionCode === "string" ? body.sessionCode : "";
  const requisitionId = typeof body?.requisitionId === "string" ? body.requisitionId : "";

  if (!sessionCode || !requisitionId) {
    return respond("/api/lab-requisitions/editor-session", requestId, started, 400, {
      error: "sessionCode and requisitionId are required.",
    });
  }

  const auth = await getCurrentSession();
  if (!auth) {
    return respond("/api/lab-requisitions/editor-session", requestId, started, 401, {
      error: "Authentication required.",
    });
  }
  if (auth.userType !== "provider") {
    return respond("/api/lab-requisitions/editor-session", requestId, started, 403, {
      error: "Only providers can open editor sessions.",
    });
  }

  const patientSession = await getSession(sessionCode);
  if (!patientSession) {
    return respond("/api/lab-requisitions/editor-session", requestId, started, 404, {
      error: "Session not found.",
    });
  }
  if (patientSession.physicianId !== auth.userId) {
    return respond("/api/lab-requisitions/editor-session", requestId, started, 403, {
      error: "You do not have access to this session.",
    });
  }

  const existingResult = await query<{
    id: string;
    patient_name: string;
    patient_email: string;
    physician_name: string | null;
    clinic_name: string | null;
    clinic_address: string | null;
    labs: any;
    additional_instructions: string | null;
  }>(
    `SELECT id, patient_name, patient_email, physician_name, clinic_name, clinic_address, labs, additional_instructions
     FROM lab_requisitions
     WHERE id = $1 AND session_code = $2
     LIMIT 1`,
    [requisitionId, sessionCode],
  );

  if (existingResult.rows.length === 0) {
    return respond("/api/lab-requisitions/editor-session", requestId, started, 404, {
      error: "Lab requisition not found for this session.",
    });
  }

  const existing = existingResult.rows[0];
  const labs = Array.isArray(existing.labs) ? existing.labs.map((v: unknown) => String(v)) : [];
  const mapped = mapLabTestsToEformFields(labs);
  const existingInstructionsSanitized = sanitizeAdditionalInstructions(existing.additional_instructions || "");
  const existingInstructionsLower = existingInstructionsSanitized.toLowerCase();
  const missingUnmappedTests = mapped.unmappedTests.filter(
    (test) => !existingInstructionsLower.includes(test.toLowerCase()),
  );
  const computedUnmappedLine = missingUnmappedTests.join(", ");
  const combinedAdditionalInstructions = combineUniqueInstructionLines([
    existingInstructionsSanitized,
    computedUnmappedLine,
  ]);

  const payload = buildLabRequisitionPrefillPayload({
    requestId,
    patientName: existing.patient_name || patientSession.patientName,
    patientEmail: existing.patient_email || patientSession.patientEmail,
    patientSex: patientSession.patientProfile?.sex || "",
    physicianName: existing.physician_name || "",
    clinicName: existing.clinic_name || "",
    clinicAddress: existing.clinic_address || "",
    mappedFieldIds: mapped.mappedFieldIds,
    testsDisplay: labs,
    clinicalInfoShort:
      (typeof patientSession.history?.assessment === "string" && patientSession.history.assessment) ||
      patientSession.chiefComplaint ||
      "",
    priority: "routine",
    additionalInstructions: combinedAdditionalInstructions,
    unmappedTests: mapped.unmappedTests,
  });

  const token = await createLabEditorSession({
    physicianId: auth.userId,
    sessionCode,
    sourceRequisitionId: existing.id,
    payload,
  });
  const requestOrigin = resolveRequestOrigin(request);
  const editorUrl = buildLabEditorUrl({ requestOrigin, editorToken: token });

  return respond("/api/lab-requisitions/editor-session", requestId, started, 200, {
    token,
    editorUrl,
  });
}

