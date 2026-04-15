import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { extractPdfTextWithAzureDocumentIntelligence } from "@/lib/invitation-pdf-summary";
import { logPhysicianPhiAudit } from "@/lib/phi-audit";
import { resolveWorkforceScope } from "@/lib/transcription-store";
import { getRequestIp } from "@/lib/invitation-security";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { logDebug } from "@/lib/secure-logger";

const FORMAT_PROMPTS: Record<string, string> = {
  "medical-legal": `You are a medical-legal report writer assisting a physician. Using the extracted medical records, write a comprehensive Medical-Legal Report.
- Write in first-person physician voice ("I first saw this patient on…").
- Organize chronologically by office visit date.
- Under "Office Visits:", write one paragraph per visit describing chief complaint, findings, diagnosis, and management.
- Always include the exact date of each visit at the start of each paragraph.
- Be thorough and precise. Do not summarize — include all clinically relevant detail.
- Do not add disclaimers or mention you are an AI.`,

  "dynacare-insurance": `You are a medical report writer. Using the extracted medical records, produce a Dynacare-style insurance table.
Output a Markdown table with exactly these columns: Month | Year | C/o & Abnormal Findings | Duration | Diagnosis | Treatment
- One row per visit or per group of related visits.
- C/o & Abnormal Findings: chief complaints and notable findings.
- Duration: duration of complaint (e.g. "1 year", "ongoing").
- Be concise within each cell.
- Do not add disclaimers or mention you are an AI.`,

  "general": `You are a clinical report writer assisting a physician. Using the extracted medical records, write a clear and comprehensive General Clinical Summary.
- Organize by date or by problem, whichever is more appropriate.
- Include all clinically relevant diagnoses, findings, treatments, and follow-up plans.
- Be thorough. Do not add disclaimers or mention you are an AI.`,
};

const FALLBACK_SYSTEM_PROMPT = `You are a clinical report writer assisting a physician. Using the extracted medical records provided, generate a clear, structured, and comprehensive report as instructed.
- Be thorough and precise.
- Do not add disclaimers or mention you are an AI.`;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    const res = NextResponse.json(
      { error: "Record summarization is disabled in HIPAA mode (external AI blocked)." },
      { status },
    );
    logRequestMeta("/api/physician/summarize-records", requestId, status, Date.now() - started);
    return res;
  }

  try {
    const auth = await getCurrentSession();
    if (!auth) {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required." }, { status });
      logRequestMeta("/api/physician/summarize-records", requestId, status, Date.now() - started);
      return res;
    }
    if (auth.userType !== "provider") {
      status = 403;
      const res = NextResponse.json({ error: "Provider access required." }, { status });
      logRequestMeta("/api/physician/summarize-records", requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = getEffectivePhysicianId(auth);
    const scope = resolveWorkforceScope({
      userType: auth.userType,
      userId: physicianId,
      organizationId: auth.organizationId || null,
    });
    if (!scope) {
      status = 403;
      const res = NextResponse.json({ error: "Provider access required." }, { status });
      logRequestMeta("/api/physician/summarize-records", requestId, status, Date.now() - started);
      return res;
    }

    const formData = await request.formData();
    const maybeFile = formData.get("record");
    const format = (formData.get("format") as string | null) || "";
    const instructions = (formData.get("instructions") as string | null) || "";

    if (!(maybeFile instanceof File)) {
      status = 400;
      const res = NextResponse.json({ error: "No PDF file provided. Expected field name 'record'." }, { status });
      logRequestMeta("/api/physician/summarize-records", requestId, status, Date.now() - started);
      return res;
    }

    const file = maybeFile as File;

    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      status = 400;
      const res = NextResponse.json({ error: "Invalid file type. Only PDF files are supported." }, { status });
      logRequestMeta("/api/physician/summarize-records", requestId, status, Date.now() - started);
      return res;
    }

    const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
    if (file.size > MAX_FILE_SIZE) {
      status = 400;
      const res = NextResponse.json({ error: "File size exceeds 20MB limit." }, { status });
      logRequestMeta("/api/physician/summarize-records", requestId, status, Date.now() - started);
      return res;
    }

    if (!format && !instructions.trim()) {
      status = 400;
      const res = NextResponse.json(
        { error: "Please select a report format or provide instructions (or both)." },
        { status },
      );
      logRequestMeta("/api/physician/summarize-records", requestId, status, Date.now() - started);
      return res;
    }

    // Extract PDF text via Azure Document Intelligence
    const extractedText = await extractPdfTextWithAzureDocumentIntelligence(file);
    if (!extractedText.trim()) {
      status = 422;
      const res = NextResponse.json({ error: "Could not extract text from the uploaded PDF." }, { status });
      logRequestMeta("/api/physician/summarize-records", requestId, status, Date.now() - started);
      return res;
    }

    // Build system prompt: format template + optional physician instructions
    const formatPrompt = FORMAT_PROMPTS[format] || FALLBACK_SYSTEM_PROMPT;
    const systemPrompt = instructions.trim()
      ? `${formatPrompt}\n\nAdditional instructions from the physician:\n${instructions.trim()}`
      : formatPrompt;

    // Clip to ~60,000 chars to stay within model context limits
    const clippedText =
      extractedText.length > 60000
        ? `${extractedText.slice(0, 60000)}\n\n[TRUNCATED — document exceeded processing limit]`
        : extractedText;

    const azure = getAzureOpenAIClient();
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Extracted medical records:\n\n${clippedText}` },
      ],
      max_completion_tokens: 20000,
    });

    const report = completion.choices?.[0]?.message?.content?.trim() || "";
    if (!report) {
      throw new Error("Azure OpenAI did not return any content.");
    }

    // PHI audit log — records that this physician accessed and summarized a medical record PDF
    await logPhysicianPhiAudit({
      physicianId,
      eventType: "record_summary_generated",
      ipAddress: getRequestIp(request.headers),
      userAgent: request.headers.get("user-agent"),
      metadata: {
        requestId,
        format: format || "custom",
        hasInstructions: !!instructions.trim(),
        fileSizeBytes: file.size,
        extractedTextLength: extractedText.length,
        reportLength: report.length,
      },
    });

    const res = NextResponse.json({ report });
    logRequestMeta("/api/physician/summarize-records", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[physician/summarize-records] Report generation failed.");
    logDebug("[physician/summarize-records] Error details", { errorMessage: msg });
    status = 500;
    const res = NextResponse.json(
      {
        error: "Failed to generate the report.",
        details: process.env.NODE_ENV === "development" ? msg : undefined,
      },
      { status },
    );
    logRequestMeta("/api/physician/summarize-records", requestId, status, Date.now() - started);
    return res;
  }
}
