import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getSession } from "@/lib/session-store";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { logDebug } from "@/lib/secure-logger";

const allowedActions = ["referral_letter", "labs", "custom"] as const;
type HpiAction = (typeof allowedActions)[number];

const systemPrompt = `You are a clinical assistant helping physicians act on a History of Present Illness (HPI).
- Use only the provided clinical context.
- Be concise, actionable, and avoid boilerplate.
- Do not invent data; if a detail is missing, omit it.
- Refer to the patient generically (\"the patient\"), avoid names and identifiers.
- No disclaimers.`;

function buildUserPrompt(params: {
  action: HpiAction;
  prompt?: string;
  context: string;
}) {
  const { action, prompt, context } = params;

  if (action === "referral_letter") {
    return `Task: Draft a concise referral letter based on this HPI.\nGoals: reason for referral, pertinent positives/negatives, key assessment points, suggested specialty, and urgency. Keep it under 220 words.\nContext:\n${context}\nExtra instructions:\n${prompt || "None"}`;
  }

  if (action === "labs") {
    return `Task: Recommend labs/imaging or diagnostics based on this HPI. Provide brief rationale for each item. Keep it concise.\nContext:\n${context}\nExtra instructions:\n${prompt || "None"}`;
  }

  return `Task: Follow the physician request using the HPI context.\nContext:\n${context}\nPhysician request:\n${prompt || "No additional instructions provided."}`;
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    const res = NextResponse.json(
      { error: "AI actions on HPI are disabled in HIPAA mode (external AI blocked)." },
      { status }
    );
    logRequestMeta("/api/physician/hpi-actions", requestId, status, Date.now() - started);
    return res;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    status = 400;
    const res = NextResponse.json(
      { error: "Invalid JSON body." },
      { status }
    );
    logRequestMeta("/api/physician/hpi-actions", requestId, status, Date.now() - started);
    return res;
  }

  const { sessionCode, action, prompt } = (body || {}) as {
    sessionCode?: string;
    action?: HpiAction;
    prompt?: string;
  };

  if (!sessionCode || typeof sessionCode !== "string") {
    status = 400;
    const res = NextResponse.json(
      { error: "sessionCode is required." },
      { status }
    );
    logRequestMeta("/api/physician/hpi-actions", requestId, status, Date.now() - started);
    return res;
  }

  if (!action || !allowedActions.includes(action)) {
    status = 400;
    const res = NextResponse.json(
      { error: `action must be one of: ${allowedActions.join(", ")}` },
      { status }
    );
    logRequestMeta("/api/physician/hpi-actions", requestId, status, Date.now() - started);
    return res;
  }

  const session = await getCurrentSession();
  if (!session) {
    status = 401;
    const res = NextResponse.json(
      { error: "Authentication required" },
      { status }
    );
    logRequestMeta("/api/physician/hpi-actions", requestId, status, Date.now() - started);
    return res;
  }

  if (session.userType !== "provider") {
    status = 403;
    const res = NextResponse.json(
      { error: "Only providers can request HPI AI actions" },
      { status }
    );
    logRequestMeta("/api/physician/hpi-actions", requestId, status, Date.now() - started);
    return res;
  }

  const patientSession = await getSession(sessionCode);
  if (!patientSession) {
    status = 404;
    const res = NextResponse.json(
      { error: "Session not found or expired" },
      { status }
    );
    logRequestMeta("/api/physician/hpi-actions", requestId, status, Date.now() - started);
    return res;
  }

  if (patientSession.physicianId !== session.userId) {
    status = 403;
    const res = NextResponse.json(
      { error: "You do not have access to this session" },
      { status }
    );
    logRequestMeta("/api/physician/hpi-actions", requestId, status, Date.now() - started);
    return res;
  }

  const hpi = patientSession.history;
  if (!hpi || !hpi.summary) {
    status = 400;
    const res = NextResponse.json(
      { error: "HPI data is missing for this session." },
      { status }
    );
    logRequestMeta("/api/physician/hpi-actions", requestId, status, Date.now() - started);
    return res;
  }

  const contextParts = [
    `Chief complaint: ${patientSession.chiefComplaint || "N/A"}`,
    `HPI summary: ${hpi.summary}`,
  ];

  if (hpi.assessment) {
    contextParts.push(`Assessment: ${hpi.assessment}`);
  }
  if (Array.isArray((hpi as any).physicalFindings) && (hpi as any).physicalFindings.length > 0) {
    contextParts.push(`Physical findings: ${(hpi as any).physicalFindings.join("; ")}`);
  }
  if (Array.isArray(hpi.positives) && hpi.positives.length > 0) {
    contextParts.push(`Pertinent positives: ${hpi.positives.join("; ")}`);
  }
  if (Array.isArray(hpi.negatives) && hpi.negatives.length > 0) {
    contextParts.push(`Pertinent negatives: ${hpi.negatives.join("; ")}`);
  }
  if (Array.isArray(hpi.investigations) && hpi.investigations.length > 0) {
    contextParts.push(`Suggested investigations: ${hpi.investigations.join("; ")}`);
  }
  if (Array.isArray(hpi.plan) && hpi.plan.length > 0) {
    contextParts.push(`Plan items: ${hpi.plan.join("; ")}`);
  }
  if (patientSession.patientProfile) {
    const profile = patientSession.patientProfile;
    const profileBits = [
      profile.age ? `Age: ${profile.age}` : null,
      profile.sex ? `Sex: ${profile.sex}` : null,
      profile.pmh ? `PMH: ${profile.pmh}` : null,
      profile.currentMedications ? `Meds: ${profile.currentMedications}` : null,
      profile.allergies ? `Allergies: ${profile.allergies}` : null,
    ].filter(Boolean);
    if (profileBits.length) {
      contextParts.push(`Patient profile: ${profileBits.join("; ")}`);
    }
  }

  const context = contextParts.join("\n");

  let azure;
  try {
    azure = getAzureOpenAIClient();
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Azure OpenAI is not configured." },
      { status: 500 }
    );
  }

  try {
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: buildUserPrompt({ action, prompt, context }) },
      ],
      // Some Azure models only allow the default temperature; use 1 to satisfy that constraint.
      temperature: 1,
      max_completion_tokens: 500,
    });

    const result = completion.choices?.[0]?.message?.content?.trim() || "";
    if (!result) {
      throw new Error("No content returned from Azure OpenAI.");
    }

    const res = NextResponse.json({ result });
    logRequestMeta("/api/physician/hpi-actions", requestId, status, Date.now() - started);
    return res;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[physician/hpi-actions] AI generation failed:", errorMessage);
    logDebug("[physician/hpi-actions] Error details", { errorMessage });
    status = 502;
    const res = NextResponse.json(
      {
        error: "Unable to generate response right now.",
        details: process.env.NODE_ENV === "development" ? errorMessage : undefined,
      },
      { status }
    );
    logRequestMeta("/api/physician/hpi-actions", requestId, status, Date.now() - started);
    return res;
  }
}

