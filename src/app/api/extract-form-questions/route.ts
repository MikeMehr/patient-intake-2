/**
 * POST /api/extract-form-questions
 * Extracts a structured list of questions/fields from an uploaded form PDF.
 * Requires authenticated physician session.
 */

import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import {
  extractPdfTextWithAzureDocumentIntelligence,
  assertValidPdfUpload,
} from "@/lib/invitation-pdf-summary";
import { logDebug } from "@/lib/secure-logger";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

const SYSTEM_INSTRUCTION = `You are a clinical assistant. Extract only clinically useful, patient-answerable items from this form — questions or fields that a patient can meaningfully answer during a medical interview about their health, injury, or condition.

Return ONLY a JSON array of strings — no commentary, no explanation, no markdown fences. Each string is one specific clinical question rephrased in natural language.

Example output:
["What is the date of your injury?", "What is the nature of your disability?", "What was the last date you were able to work?", "What is your current diagnosis?", "Describe the mechanism of injury.", "Are you currently receiving any treatment?"]

INCLUDE — clinical and functional items the patient can answer:
- Dates of injury, illness onset, treatment, surgery, or last able to work
- Nature, description, or mechanism of injury or disability
- Body parts affected or symptoms experienced
- Diagnosis, medical conditions, or relevant history
- Current or past treatments, medications, or restrictions
- Functional limitations or work capacity questions
- Prognosis or return-to-work expectations
- Specific yes/no medical questions about the patient's health

EXCLUDE — do not include any of the following:
- Patient demographics already collected at intake (name, date of birth, address, phone, health card number, insurance number)
- Physician, clinic, or hospital name, address, or contact details
- Employer name, address, contact, or job title
- Insurer, adjuster, claim number, or policy number
- Signature lines, authorization boxes, or consent checkboxes
- Form version numbers, office-use-only fields, or administrative codes
- Billing, fee, or payment fields
- Fields asking for physician credentials, license number, or specialty

- Return an empty array [] if no clinical questions are found
- Maximum 40 questions`;

export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    const res = NextResponse.json(
      { error: "Form question extraction is disabled in HIPAA mode." },
      { status },
    );
    logRequestMeta("/api/extract-form-questions", requestId, status, Date.now() - started);
    return res;
  }

  // Require authenticated physician session
  const session = await getCurrentSession();
  if (!session) {
    status = 401;
    const res = NextResponse.json({ error: "Authentication required" }, { status });
    logRequestMeta("/api/extract-form-questions", requestId, status, Date.now() - started);
    return res;
  }
  if ((session as { userType?: string }).userType !== "provider") {
    status = 403;
    const res = NextResponse.json({ error: "Only providers can extract form questions" }, { status });
    logRequestMeta("/api/extract-form-questions", requestId, status, Date.now() - started);
    return res;
  }

  let azure;
  try {
    azure = getAzureOpenAIClient();
  } catch (err) {
    status = 500;
    const res = NextResponse.json(
      { error: (err as Error).message || "Azure OpenAI is not configured." },
      { status },
    );
    logRequestMeta("/api/extract-form-questions", requestId, status, Date.now() - started);
    return res;
  }

  let file: File | null = null;
  try {
    const formData = await request.formData();
    const maybeFile = formData.get("form");
    if (maybeFile instanceof File) {
      file = maybeFile;
    }
  } catch {
    // fall through to error below
  }

  if (!file) {
    status = 400;
    const res = NextResponse.json(
      { error: "No PDF file provided. Expected field name 'form'." },
      { status },
    );
    logRequestMeta("/api/extract-form-questions", requestId, status, Date.now() - started);
    return res;
  }

  try {
    assertValidPdfUpload(file, "form");
  } catch (err) {
    status = 400;
    const res = NextResponse.json({ error: (err as Error).message }, { status });
    logRequestMeta("/api/extract-form-questions", requestId, status, Date.now() - started);
    return res;
  }

  try {
    // Extract raw text via Azure Document Intelligence
    const extractedText = await extractPdfTextWithAzureDocumentIntelligence(file);

    const clippedText =
      extractedText.length > 40000
        ? `${extractedText.slice(0, 40000)}\n\n[TRUNCATED]`
        : extractedText;

    // Extract questions as JSON array via Azure OpenAI
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: SYSTEM_INSTRUCTION },
        {
          role: "user",
          content: clippedText
            ? `Form PDF extracted text:\n\n${clippedText}`
            : "A form PDF was uploaded but no text could be extracted. Return an empty array [].",
        },
      ],
      max_completion_tokens: 1200,
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() || "[]";

    let questions: string[] = [];
    try {
      // Strip potential markdown fences
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        questions = parsed
          .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
          .slice(0, 50);
      }
    } catch {
      logDebug("[extract-form-questions] Failed to parse OpenAI JSON response", { raw });
      // Return empty list rather than an error — physician can still proceed without popup
      questions = [];
    }

    const res = NextResponse.json({ questions });
    logRequestMeta("/api/extract-form-questions", requestId, status, Date.now() - started);
    return res;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Log the actual error message in all environments so Azure App Service logs capture it
    console.error("[extract-form-questions] Processing failed:", errorMessage);
    status = 502;
    const res = NextResponse.json(
      {
        error: "Unable to extract form questions right now.",
        details: process.env.NODE_ENV === "development" ? errorMessage : undefined,
      },
      { status },
    );
    logRequestMeta("/api/extract-form-questions", requestId, status, Date.now() - started);
    return res;
  }
}
