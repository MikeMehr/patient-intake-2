import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session-store";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { mapLabTestsToEformFields } from "@/lib/lab-requisition-mapping";
import { buildLabRequisitionPrefillPayload } from "@/lib/lab-requisition-payload";
import { createLabEditorSession } from "@/lib/lab-requisition-editor-session";
import { sanitizeAssistiveClinicalText } from "@/lib/clinical-safety";

export const runtime = "nodejs";

type StructuredLabOrder = {
  tests: string[];
  clinicalInfoShort: string;
  priority: "routine" | "urgent";
};

function parseStructuredLabOrder(raw: string): StructuredLabOrder {
  const fromCodeFence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? raw;
  const jsonBody = fromCodeFence.match(/\{[\s\S]*\}/)?.[0] ?? fromCodeFence;
  const parsed = JSON.parse(jsonBody);
  const tests = Array.isArray(parsed?.tests)
    ? parsed.tests.map((item: unknown) => String(item).trim()).filter(Boolean)
    : [];
  const clinicalInfoShortRaw =
    typeof parsed?.clinicalInfoShort === "string" ? parsed.clinicalInfoShort.trim() : "";
  const clinicalInfoShort = sanitizeAssistiveClinicalText(clinicalInfoShortRaw).text;
  const priority = parsed?.priority === "urgent" ? "urgent" : "routine";
  return { tests, clinicalInfoShort, priority };
}

function fallbackClinicalInfo(patientSession: Awaited<ReturnType<typeof getSession>>): string {
  if (!patientSession) return "";
  const raw = (
    patientSession.chiefComplaint?.trim() ||
    (patientSession.history?.assessment as string)?.trim() ||
    (patientSession.history?.summary as string)?.trim() ||
    ""
  ).slice(0, 120);
  return sanitizeAssistiveClinicalText(raw).text;
}

async function generateLabsWithAi(context: string): Promise<StructuredLabOrder> {
  const azure = getAzureOpenAIClient();
  const completion = await azure.client.chat.completions.create({
    model: azure.deployment,
    messages: [
      {
        role: "system",
        content:
          "You are a clinical assistant. Return only strict JSON with keys tests, clinicalInfoShort, priority. No markdown. Use non-definitive assistive wording.",
      },
      {
        role: "user",
        content: `Based on the following HPI context, suggest routine labs only (no imaging). Keep tests concise and practical.

Return valid JSON exactly like:
{"tests":["CBC","Ferritin"],"clinicalInfoShort":"Fatigue workup","priority":"routine"}

Context:
${context}`,
      },
    ],
    temperature: 1,
    max_completion_tokens: 300,
  });
  const raw = completion.choices?.[0]?.message?.content?.trim() || "";
  if (!raw) {
    throw new Error("AI returned empty lab order.");
  }
  return parseStructuredLabOrder(raw);
}

function uniqueLabs(labs: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  labs.forEach((lab) => {
    const normalized = lab.toLowerCase().trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    deduped.push(lab.trim());
  });
  return deduped;
}

function resolveRequestOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") || "https";
  if (host) return `${protocol}://${host}`;
  return new URL(request.url).origin;
}

function resolveCanonicalOrigin(request: NextRequest): string {
  // Always prefer request-derived origin for editor links so the eForm host
  // matches the active authenticated dashboard origin (avoids cross-origin
  // editor-session/save calls when env points to a different domain).
  return resolveRequestOrigin(request);
}

function buildLabEditorUrl(args: { requestOrigin: string; editorToken: string }): string {
  const configured = (process.env.LAB_REQUISITION_EFORM_URL || "").trim();
  const fallback = `${args.requestOrigin}/eforms/1.1LabRequisition/1.1LabRequisition.html`;
  let base = fallback;
  // Only use configured URL when it matches the current request origin.
  // This prevents stale/incorrect env values (old domains) from generating broken editor links.
  if (configured) {
    try {
      const configuredOrigin = new URL(configured).origin;
      if (configuredOrigin === args.requestOrigin) {
        base = configured;
      }
    } catch {
      // ignore invalid configured URL and fall back
    }
  }

  // Prefer URL parsing to handle existing query params.
  try {
    const url = new URL(base);
    url.searchParams.set("editorToken", args.editorToken);
    return url.toString();
  } catch {
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}editorToken=${encodeURIComponent(args.editorToken)}`;
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  const respond = (body: Record<string, unknown>, responseStatus = status) => {
    status = responseStatus;
    const res = NextResponse.json(body, { status: responseStatus });
    logRequestMeta("/api/lab-requisitions/generate", requestId, responseStatus, Date.now() - started);
    return res;
  };

  try {
    const body = await request.json();
    const {
      sessionCode,
      patientName,
      patientEmail,
      physicianName,
      clinicName,
      clinicAddress,
      labs,
      instructions,
    } = body ?? {};

    if (!sessionCode || typeof sessionCode !== "string") {
      return respond({ error: "sessionCode is required." }, 400);
    }

    const auth = await getCurrentSession();
    if (!auth) {
      return respond({ error: "Authentication required." }, 401);
    }
    if (auth.userType !== "provider") {
      return respond({ error: "Only providers can generate requisitions." }, 403);
    }

    const patientSession = await getSession(sessionCode);
    if (!patientSession) {
      return respond({ error: "Session not found." }, 404);
    }
    if (patientSession.physicianId !== auth.userId) {
      return respond({ error: "You do not have access to this session." }, 403);
    }

    const physicianResult = await query<{
      first_name: string;
      last_name: string;
      clinic_name: string | null;
      clinic_address: string | null;
    }>(
      `SELECT first_name, last_name, clinic_name, clinic_address
       FROM physicians
       WHERE id = $1
       LIMIT 1`,
      [auth.userId],
    );
    const physician = physicianResult.rows[0];

    const resolvedPatientName =
      typeof patientName === "string" && patientName.trim().length > 0
        ? patientName.trim()
        : patientSession.patientName;
    const resolvedPatientEmail =
      typeof patientEmail === "string" && patientEmail.trim().length > 0
        ? patientEmail.trim()
        : patientSession.patientEmail;
    const resolvedPhysicianName =
      typeof physicianName === "string" && physicianName.trim().length > 0
        ? physicianName.trim()
        : `${physician?.first_name ?? ""} ${physician?.last_name ?? ""}`.trim();
    const resolvedClinicName =
      typeof clinicName === "string" && clinicName.trim().length > 0
        ? clinicName.trim()
        : physician?.clinic_name ?? "";
    const resolvedClinicAddress =
      typeof clinicAddress === "string" && clinicAddress.trim().length > 0
        ? clinicAddress.trim()
        : physician?.clinic_address ?? "";

    const uiLabs = Array.isArray(labs)
      ? uniqueLabs(labs.map((item: unknown) => String(item)).filter(Boolean))
      : [];

    const contextParts = [
      `Chief complaint: ${patientSession.chiefComplaint || "N/A"}`,
      `HPI summary: ${patientSession.history?.summary || "N/A"}`,
      `Assessment: ${patientSession.history?.assessment || "N/A"}`,
      `Plan: ${
        Array.isArray(patientSession.history?.plan)
          ? patientSession.history.plan.join("; ")
          : (patientSession.history?.plan as string) || "N/A"
      }`,
    ];
    const aiOrder =
      uiLabs.length > 0
        ? {
            tests: uiLabs,
            clinicalInfoShort: fallbackClinicalInfo(patientSession),
            priority: "routine" as const,
          }
        : await generateLabsWithAi(contextParts.join("\n"));

    const orderedTests = uniqueLabs(aiOrder.tests);
    if (orderedTests.length === 0) {
      return respond({ error: "No labs available to generate requisition." }, 400);
    }

    const mapped = mapLabTestsToEformFields(orderedTests);
    const baseInstructions = typeof instructions === "string" ? instructions.trim() : "";
    const unmappedInstruction =
      mapped.unmappedTests.length > 0
        ? mapped.unmappedTests.join(", ")
        : "";
    const combinedInstructions = [baseInstructions, unmappedInstruction]
      .filter((item) => item.length > 0)
      .join("\n");

    const payload = buildLabRequisitionPrefillPayload({
      requestId,
      patientName: resolvedPatientName,
      patientEmail: resolvedPatientEmail,
      patientSex: patientSession.patientProfile?.sex || "",
      physicianName: resolvedPhysicianName,
      clinicName: resolvedClinicName,
      clinicAddress: resolvedClinicAddress,
      mappedFieldIds: mapped.mappedFieldIds,
      testsDisplay: orderedTests,
      clinicalInfoShort: aiOrder.clinicalInfoShort || fallbackClinicalInfo(patientSession),
      priority: aiOrder.priority,
      additionalInstructions: combinedInstructions,
      unmappedTests: mapped.unmappedTests,
    });
    const token = await createLabEditorSession({
      physicianId: auth.userId,
      sessionCode,
      payload,
    });
    const canonicalOrigin = resolveCanonicalOrigin(request);
    const editorUrl = buildLabEditorUrl({ requestOrigin: canonicalOrigin, editorToken: token });

    return respond({
      success: true,
      editorToken: token,
      editorUrl,
      summary: orderedTests.join(", "),
      unmappedTests: mapped.unmappedTests,
    });
  } catch (error) {
    status = 500;
    console.error("[lab-requisitions/generate] POST failed:", error);
    return respond({ error: "Failed to generate lab requisition PDF." }, 500);
  }
}
