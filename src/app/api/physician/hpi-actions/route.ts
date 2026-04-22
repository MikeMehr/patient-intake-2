import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { getSession } from "@/lib/session-store";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { logDebug } from "@/lib/secure-logger";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require("pdf-parse");

const ALLOWED_FILE_MIME_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif",
  "application/pdf",
]);
const MAX_FILE_BASE64_LENGTH = 7_000_000; // ~5 MB raw

const allowedActions = ["referral_letter", "labs", "custom", "merge_transcript"] as const;
type HpiAction = (typeof allowedActions)[number];

const systemPrompt = `You are a clinical assistant helping physicians act on a History of Present Illness (HPI).
- Use only the provided clinical context.
- Be concise, actionable, and avoid boilerplate.
- Do not invent data; if a detail is missing, omit it.
- Refer to the patient generically ("the patient"), avoid names and identifiers.
- No disclaimers.`;

const visionSystemPrompt = `You are a clinical assistant helping physicians. You will receive an HPI and a clinical image.
- Analyze the attached image carefully and describe the visible clinical findings (morphology, distribution, color, size, any notable features).
- Incorporate both the image findings and the HPI context into your response.
- Be concise, actionable, and clinically precise.
- Do not invent data; describe only what is visible.
- Refer to the patient generically ("the patient"), avoid names and identifiers.
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

  const { sessionCode, action, prompt, transcript, language, fileBase64, fileMimeType } = (body || {}) as {
    sessionCode?: string;
    action?: HpiAction;
    prompt?: string;
    transcript?: string;
    language?: string;
    fileBase64?: string;
    fileMimeType?: string;
  };

  // Validate optional file attachment
  if (fileBase64 !== undefined) {
    if (typeof fileBase64 !== "string" || fileBase64.length > MAX_FILE_BASE64_LENGTH) {
      return NextResponse.json({ error: "File is too large (max 5 MB)." }, { status: 400 });
    }
    if (!fileMimeType || !ALLOWED_FILE_MIME_TYPES.has(fileMimeType)) {
      return NextResponse.json({ error: "Invalid file type. Supported: PNG, JPEG, WEBP, HEIC, HEIF, PDF." }, { status: 400 });
    }
  }

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

  if (patientSession.physicianId !== getEffectivePhysicianId(session)) {
    status = 403;
    const res = NextResponse.json(
      { error: "You do not have access to this session" },
      { status }
    );
    logRequestMeta("/api/physician/hpi-actions", requestId, status, Date.now() - started);
    return res;
  }

  if (action === "merge_transcript") {
    const trimmedTranscript = typeof transcript === "string" ? transcript.trim() : "";
    if (!trimmedTranscript) {
      status = 400;
      const res = NextResponse.json({ error: "transcript is required for merge_transcript action." }, { status });
      logRequestMeta("/api/physician/hpi-actions", requestId, status, Date.now() - started);
      return res;
    }
    if (trimmedTranscript.length > 20000) {
      status = 400;
      const res = NextResponse.json({ error: "transcript is too long (max 20000 characters)." }, { status });
      logRequestMeta("/api/physician/hpi-actions", requestId, status, Date.now() - started);
      return res;
    }

    const hpi = patientSession.history;
    const existingHpiParts = [
      `Subjective:\n${hpi?.summary || "None"}`,
      `Physical Findings:\n${Array.isArray((hpi as any)?.physicalFindings) && (hpi as any).physicalFindings.length > 0 ? (hpi as any).physicalFindings.join("\n") : "None"}`,
      `Assessment:\n${hpi?.assessment || "None"}`,
      `Investigations:\n${Array.isArray(hpi?.investigations) && hpi.investigations.length > 0 ? hpi.investigations.join("\n") : "None"}`,
      `Plan:\n${Array.isArray((hpi as any)?.plan) && (hpi as any).plan.length > 0 ? (hpi as any).plan.join("\n") : "None"}`,
      `Patient Final Comments:\n${(hpi as any)?.patientFinalQuestionsCommentsEnglish || (hpi as any)?.patientFinalQuestionsComments || "None"}`,
    ].join("\n\n");

    const langName = typeof language === "string" && language.trim() ? language.trim() : "English";
    const isNonEnglish = langName.toLowerCase() !== "english";

    const mergeSystemPrompt = `You are a clinical documentation assistant. You will be given an existing History of Present Illness (HPI) generated from a patient intake interview, and a transcript of the physician's subsequent encounter with the patient (which may include additional history questions, physical exam findings, assessment, and plan discussion).

Your task: produce an updated, combined HPI that integrates both sources into a single coherent clinical note. Preserve all relevant information from both sources, resolve conflicts by deferring to the physician's findings, and do not invent information.${isNonEnglish ? `\n\nNOTE: The physician encounter transcript is in ${langName}. Translate its content into English when incorporating it into the HPI. The final output must be entirely in English.` : ""}

IMPORTANT: Your response must follow EXACTLY this format with these exact section headers. Do not add, rename, or reorder sections:

Subjective:
<paragraph summarizing history of present illness>

Physical Findings:
<bullet list, one per line, prefixed with "- "; or "None" if not applicable>

Assessment:
<paragraph with clinical assessment and differential>

Investigations:
<bullet list, one per line, prefixed with "- "; or "None" if none ordered>

Plan:
<bullet list, one per line, prefixed with "- ">

Patient Final Comments:
<preserve original patient final comments unchanged; or "None">`;

    const mergeUserPrompt = `Existing HPI (from patient intake):\n${existingHpiParts}\n\nPhysician encounter transcript:\n${trimmedTranscript}\n\nProduce the updated combined HPI now.`;

    let azure;
    try {
      azure = getAzureOpenAIClient();
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message || "Azure OpenAI is not configured." }, { status: 500 });
    }

    try {
      const completion = await azure.client.chat.completions.create({
        model: azure.deployment,
        messages: [
          { role: "system", content: mergeSystemPrompt },
          { role: "user", content: mergeUserPrompt },
        ],
        temperature: 1,
        max_completion_tokens: 1200,
      });

      const result = completion.choices?.[0]?.message?.content?.trim() || "";
      if (!result) throw new Error("No content returned from Azure OpenAI.");

      const res = NextResponse.json({ result });
      logRequestMeta("/api/physician/hpi-actions", requestId, status, Date.now() - started);
      return res;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[physician/hpi-actions] merge_transcript failed:", errorMessage);
      status = 502;
      const res = NextResponse.json(
        { error: "Unable to merge transcript right now.", details: process.env.NODE_ENV === "development" ? errorMessage : undefined },
        { status }
      );
      logRequestMeta("/api/physician/hpi-actions", requestId, status, Date.now() - started);
      return res;
    }
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

  const hasFile = typeof fileBase64 === "string" && fileBase64.length > 0;
  const isPdf = hasFile && fileMimeType === "application/pdf";
  const isImage = hasFile && !isPdf;

  let azure;
  try {
    azure = getAzureOpenAIClient();
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Azure OpenAI is not configured." },
      { status: 500 }
    );
  }

  // For PDFs: extract text and append to context
  let pdfText: string | null = null;
  if (isPdf) {
    try {
      const buffer = Buffer.from(fileBase64!, "base64");
      const parsed = await pdfParse(buffer);
      pdfText = parsed.text?.trim() || null;
    } catch {
      return NextResponse.json({ error: "Could not read the PDF. Make sure it is a valid, text-based PDF." }, { status: 400 });
    }
    if (!pdfText) {
      return NextResponse.json({ error: "No text could be extracted from the PDF." }, { status: 400 });
    }
  }

  const activeSystemPrompt = isImage ? visionSystemPrompt : systemPrompt;

  function buildPromptWithFile(): string {
    const base = buildUserPrompt({ action: action!, prompt, context });
    if (!pdfText) return base;
    return `${base}\n\nAttached document (extracted text):\n${pdfText.slice(0, 8000)}`;
  }

  const userMessageContent = isImage
    ? [
        { type: "text" as const, text: buildUserPrompt({ action: action!, prompt, context }) },
        { type: "image_url" as const, image_url: { url: `data:${fileMimeType};base64,${fileBase64}` } },
      ]
    : buildPromptWithFile();

  try {
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: activeSystemPrompt },
        { role: "user", content: userMessageContent as any },
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

