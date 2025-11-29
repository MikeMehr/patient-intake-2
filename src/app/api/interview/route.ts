import {
  interviewRequestSchema,
  interviewResponseSchema,
  type InterviewMessage,
  type PatientProfile,
} from "@/lib/interview-schema";
import { mockInterviewStep } from "@/lib/mock-interview";
import OpenAI from "openai";
import { NextResponse } from "next/server";

const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

const systemInstruction = `
You are an experienced clinical intake assistant. Your job is to gather a focused, efficient history of present illness for the provided chief complaint.

Rules:
- Ask only ONE concise, targeted follow-up question at a time.
- CRITICAL: Review the entire transcript before each question. Never repeat information already covered. If a topic was discussed, move on to the next important area.
- Be strategic and efficient. Prioritize the most diagnostically important questions first:
  1. Red flags and urgent concerns (e.g., chest pain with cardiac risk, severe dyspnea, neurological deficits, severe abdominal pain, signs of sepsis)
  2. Core symptom characteristics (onset, duration, severity, quality, location)
  3. Key associated symptoms and triggers/relieving factors
  4. Relevant context from past medical history, family history, and allergies
- Aim for 8-15 focused questions. Do NOT ask repetitive or redundant questions.
- Summarize when you have gathered sufficient information for a reasonable clinical assessment, even if you haven't explored every possible angle. You do NOT need to be exhaustive.
- Only provide a summary when you have:
  1. Ruled out critical red flags relevant to the chief complaint
  2. Gathered core symptom characteristics (onset, duration, severity, quality, location, triggers, relieving factors)
  3. Identified key associated symptoms
  4. Incorporated relevant context from provided past medical history, family history, current medication list, family doctor, and allergies
  5. Have enough information to make a reasonable diagnostic assessment
- Incorporate the patient's sex, age, past medical history, family history, current medication list (including OTC and supplements), primary care/family doctor, and allergies provided to you. Only ask clarifying questions if these factors are directly relevant to the current complaint and need elaboration.
- Return ONLY valid JSON. For question turns respond with {"type":"question","question":"...","rationale":"..."}. For summary turns respond with {"type":"summary","positives":[],"negatives":[],"summary":"...","investigations":[],"assessment":"...","plan":[]}.
- When summarizing, list 2-6 pertinent positives and negatives, any recommended investigations, an assessment sentence, and a succinct plan (1-6 bullet points).
- Never mention that you are an AI. Never add disclaimers.
`.trim();

const shouldMock = () =>
  process.env.MOCK_AI === "true" || process.env.NODE_ENV === "test";

export async function POST(request: Request) {
  let payload: Record<string, unknown>;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = interviewRequestSchema.safeParse(payload);
  if (!parsed.success) {
    console.error("[interview-route] Validation error:", JSON.stringify(parsed.error.format(), null, 2));
    const errorMessages = parsed.error.issues.map((err) => {
      const path = err.path.join(".");
      return path ? `${path}: ${err.message}` : err.message;
    });
    return NextResponse.json(
      { 
        error: "Invalid payload.", 
        details: parsed.error.format(),
        message: errorMessages.join("; ")
      },
      { status: 400 },
    );
  }

  const { transcript, patientProfile, chiefComplaint, imageSummary } = parsed.data;
  const lastMessage = transcript.at(-1);
  if (transcript.length > 0 && lastMessage?.role !== "patient") {
    return NextResponse.json(
      { error: "Provide a patient response before requesting another turn." },
      { status: 422 },
    );
  }

  if (shouldMock()) {
    const mockTurn = mockInterviewStep(transcript, patientProfile, chiefComplaint);
    return NextResponse.json(mockTurn);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured." },
      { status: 500 },
    );
  }

  const openai = new OpenAI({ apiKey });

  try {
    const response = await openai.responses.create({
      model,
      temperature: 0.2,
      input: [
        {
          role: "system",
          content: systemInstruction,
        },
        {
          role: "user",
          content: buildPrompt(
            chiefComplaint,
            patientProfile,
            transcript,
            typeof imageSummary === "string" && imageSummary.trim().length > 0
              ? imageSummary.trim()
              : null,
          ),
        },
      ],
    });

    const textPayload = extractText(response);
    const turn = parseInterviewTurn(textPayload);

    return NextResponse.json(turn);
  } catch (error: unknown) {
    console.error("[interview-route]", error);
    return NextResponse.json(
      { error: "Unable to continue the interview right now." },
      { status: 502 },
    );
  }
}

function buildPrompt(
  chiefComplaint: string,
  profile: PatientProfile,
  transcript: InterviewMessage[],
  imageSummary: string | null,
): string {
  const transcriptSection = transcript.length
    ? formatTranscript(transcript)
    : "Transcript: (no questions have been asked yet)";

  const imageSection = imageSummary
    ? `Image-based findings (from patient-provided photo): ${imageSummary}`
    : "Image-based findings: (no photo provided or not yet analyzed)";

  return `
Chief complaint: ${chiefComplaint}
Patient sex: ${profile.sex}
Patient age: ${profile.age}
Pertinent past medical history: ${profile.pmh}
Family history: ${profile.familyHistory}
Current medications (include OTC/supplements): ${profile.currentMedications}
Family doctor: ${profile.familyDoctor}
Documented drug allergies: ${profile.allergies}
${imageSection}
${transcriptSection}

IMPORTANT: Be focused and efficient. Review the transcript carefully to avoid repetition. Ask only the most diagnostically important questions. Aim for 8-15 targeted questions total.

Only summarize when you have:
- Ruled out critical red flags relevant to this complaint
- Gathered core symptom characteristics (onset, duration, severity, quality, location, triggers, relieving factors)
- Identified key associated symptoms
- Have enough information for a reasonable diagnostic assessment

If you still need more critical information, respond with a JSON object shaped like {"type":"question","question":"...","rationale":"..."}.
If you have sufficient information for a clinical assessment (typically after 8-15 focused questions), respond with {"type":"summary","positives":[],"negatives":[],"summary":"","investigations":[],"assessment":"","plan":[]}.
  `.trim();
}

function formatTranscript(transcript: InterviewMessage[]) {
  return (
    "Transcript:\n" +
    transcript
      .map((message) => {
        const speaker = message.role === "assistant" ? "Assistant" : "Patient";
        return `${speaker}: ${message.content}`;
      })
      .join("\n")
  );
}

type OpenAIResponse = Awaited<
  ReturnType<OpenAI["responses"]["create"]>
>;

type MessageOutput = {
  type: "message";
  content: Array<TextBlock | { type: string }>;
};

type TextBlock = {
  type: "output_text";
  text: string;
};

function extractText(response: OpenAIResponse) {
  if (!hasMessageOutput(response)) {
    throw new Error("OpenAI returned an unexpected payload.");
  }

  const message = response.output.find(
    (item): item is MessageOutput => item.type === "message",
  );

  if (!message) {
    throw new Error("OpenAI returned an unexpected payload.");
  }

  const textBlock = message.content.find(
    (item): item is TextBlock => item.type === "output_text",
  );

  if (!textBlock?.text) {
    throw new Error("OpenAI returned an unexpected payload.");
  }

  return textBlock.text.trim();
}

function hasMessageOutput(
  response: OpenAIResponse,
): response is OpenAIResponse & { output: MessageOutput[] } {
  return (
    typeof response === "object" &&
    response !== null &&
    "output" in response &&
    Array.isArray((response as { output?: unknown }).output)
  );
}

function parseInterviewTurn(payload: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("OpenAI returned invalid JSON.");
  }

  const result = interviewResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("OpenAI returned data that does not match the schema.");
  }

  return result.data;
}

