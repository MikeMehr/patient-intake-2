import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { ensureProdEnv } from "@/lib/required-env";

export type InvitationUploadDocumentKey = "labReport" | "previousLabReport" | "form";

export type InvitationUploadSummaries = {
  labReportSummary: string | null;
  previousLabReportSummary: string | null;
  formSummary: string | null;
};

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const SUMMARY_MAX_CHARS = 8000;

const DOC_TYPE_LABEL: Record<InvitationUploadDocumentKey, string> = {
  labReport: "Current Lab Report",
  previousLabReport: "Previous Lab Report",
  form: "Form",
};

const SUMMARY_SYSTEM_INSTRUCTION = `
You summarize physician-uploaded clinical PDFs for an interview assistant.

Rules:
- Return concise, factual clinical context only.
- Do NOT include diagnosis statements.
- Do NOT include treatment recommendations, medication advice, or management plans.
- If information is missing, explicitly say "Not specified in source".
- Keep output under 700 words.

Output format (plain text, exact section headers):
Document Type: <Current Lab Report | Previous Lab Report | Form>
Report Date: <value or Not specified in source>
Key Findings:
- ...
- ...
Abnormal/Flagged Items:
- ...
Relevant Normal Items:
- ...
Items To Clarify With Patient:
- ...
Data Gaps:
- ...
`.trim();

function isPdfFile(file: File): boolean {
  return (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

export function assertValidPdfUpload(file: File, fieldName: string): void {
  if (!isPdfFile(file)) {
    throw new Error(`${fieldName}: Invalid file type. Only PDF files are supported.`);
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`${fieldName}: File size exceeds 10MB limit.`);
  }
}

function getDocumentIntelligenceConfig() {
  ensureProdEnv(["AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", "AZURE_DOCUMENT_INTELLIGENCE_API_KEY"]);
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const apiKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_API_KEY;
  const apiVersion = process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION || "2024-11-30";
  const modelId = process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL || "prebuilt-read";
  if (!endpoint || !apiKey) {
    throw new Error(
      "Azure Document Intelligence is not configured. Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_API_KEY.",
    );
  }
  return {
    endpoint: endpoint.replace(/\/$/, ""),
    apiKey,
    apiVersion,
    modelId,
  };
}

async function pollDocumentIntelligenceResult(operationLocation: string, apiKey: string): Promise<string> {
  const maxAttempts = 45;
  const pollIntervalMs = 1000;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const pollResponse = await fetch(operationLocation, {
      method: "GET",
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
      },
    });
    if (!pollResponse.ok) {
      throw new Error(`Azure Document Intelligence polling failed: HTTP ${pollResponse.status}`);
    }
    const payload = (await pollResponse.json()) as {
      status?: string;
      analyzeResult?: {
        content?: string;
      };
    };

    const status = (payload.status || "").toLowerCase();
    if (status === "succeeded") {
      const content = payload.analyzeResult?.content?.trim() || "";
      return content;
    }
    if (status === "failed") {
      throw new Error("Azure Document Intelligence extraction failed.");
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error("Azure Document Intelligence timed out while extracting PDF text.");
}

export async function extractPdfTextWithAzureDocumentIntelligence(file: File): Promise<string> {
  const { endpoint, apiKey, apiVersion, modelId } = getDocumentIntelligenceConfig();
  const analyzeUrl = `${endpoint}/documentintelligence/documentModels/${encodeURIComponent(
    modelId,
  )}:analyze?api-version=${encodeURIComponent(apiVersion)}`;

  const bytes = Buffer.from(await file.arrayBuffer());
  const startResponse = await fetch(analyzeUrl, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      "Content-Type": "application/pdf",
    },
    body: bytes,
  });

  if (!startResponse.ok) {
    throw new Error(`Azure Document Intelligence request failed: HTTP ${startResponse.status}`);
  }

  const operationLocation =
    startResponse.headers.get("operation-location") ||
    startResponse.headers.get("Operation-Location");
  if (!operationLocation) {
    throw new Error("Azure Document Intelligence did not return operation location.");
  }

  return pollDocumentIntelligenceResult(operationLocation, apiKey);
}

export async function summarizeExtractedPdfTextWithAzureOpenAI(
  extractedText: string,
  documentKey: InvitationUploadDocumentKey,
): Promise<string> {
  const normalized = extractedText.trim();
  if (!normalized) {
    return `Document Type: ${DOC_TYPE_LABEL[documentKey]}\nReport Date: Not specified in source\nKey Findings:\n- Not specified in source\nAbnormal/Flagged Items:\n- Not specified in source\nRelevant Normal Items:\n- Not specified in source\nItems To Clarify With Patient:\n- Not specified in source\nData Gaps:\n- No extractable text found in PDF.`;
  }

  const clippedText =
    normalized.length > 60000 ? `${normalized.slice(0, 60000)}\n\n[TRUNCATED]` : normalized;

  const azure = getAzureOpenAIClient();
  const completion = await azure.client.chat.completions.create({
    model: azure.deployment,
    messages: [
      { role: "system", content: SUMMARY_SYSTEM_INSTRUCTION },
      {
        role: "user",
        content: `Document type: ${DOC_TYPE_LABEL[documentKey]}\n\nExtracted PDF text:\n${clippedText}`,
      },
    ],
    max_completion_tokens: 900,
  });

  const summary = completion.choices?.[0]?.message?.content?.trim() || "";
  if (!summary) {
    throw new Error("Azure OpenAI did not return a summary.");
  }
  return summary.length > SUMMARY_MAX_CHARS ? `${summary.slice(0, SUMMARY_MAX_CHARS)}...` : summary;
}

export async function buildInvitationUploadSummaries(files: {
  labReport: File | null;
  previousLabReport: File | null;
  form: File | null;
}): Promise<InvitationUploadSummaries> {
  const result: InvitationUploadSummaries = {
    labReportSummary: null,
    previousLabReportSummary: null,
    formSummary: null,
  };

  const entries: Array<{ key: InvitationUploadDocumentKey; file: File | null }> = [
    { key: "labReport", file: files.labReport },
    { key: "previousLabReport", file: files.previousLabReport },
    { key: "form", file: files.form },
  ];

  for (const entry of entries) {
    if (!entry.file) continue;
    assertValidPdfUpload(entry.file, entry.key);
    const extractedText = await extractPdfTextWithAzureDocumentIntelligence(entry.file);
    const summary = await summarizeExtractedPdfTextWithAzureOpenAI(extractedText, entry.key);
    if (entry.key === "labReport") result.labReportSummary = summary;
    if (entry.key === "previousLabReport") result.previousLabReportSummary = summary;
    if (entry.key === "form") result.formSummary = summary;
  }

  return result;
}
