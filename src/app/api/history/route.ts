import {
  historyRequestSchema,
  historyResponseSchema,
} from "@/lib/history-schema";
import { mockHistory } from "@/lib/mock-history";
import OpenAI from "openai";
import { NextResponse } from "next/server";

const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

const jsonSchemaFormat = {
  type: "json_schema",
  name: "structured_history",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      positives: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        items: { type: "string" },
      },
      negatives: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        items: { type: "string" },
      },
      summary: {
        type: "string",
        minLength: 10,
        maxLength: 600,
      },
      investigations: {
        type: "array",
        minItems: 0,
        maxItems: 6,
        items: { type: "string" },
      },
      assessment: {
        type: "string",
        minLength: 10,
        maxLength: 600,
      },
      plan: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        items: { type: "string" },
      },
    },
    required: [
      "positives",
      "negatives",
      "summary",
      "investigations",
      "assessment",
      "plan",
    ],
  },
} as const;

const systemInstruction =
  "You are a meticulous clinical intake assistant. Collect relevant history of present illness data from short prompts. Respond ONLY in JSON with keys `positives`, `negatives`, `summary`, `investigations`, `assessment`, and `plan`. Summaries must remain one paragraph, concise, and professional; investigations should be concrete tests that would clarify the presentation; assessment should be 1-2 sentences synthesizing the findings; plan should contain 1-6 specific next steps. Do not mention that you are an AI or provide disclaimers.";

const shouldMock = () =>
  process.env.MOCK_AI === "true" || process.env.NODE_ENV === "test";

export async function POST(request: Request) {
  let payload: Record<string, unknown>;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsed = historyRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid chief complaint.", details: parsed.error.format() },
      { status: 400 },
    );
  }

  if (shouldMock()) {
    return NextResponse.json({
      ...mockHistory,
      summary: `${mockHistory.summary} Chief complaint: "${parsed.data.chiefComplaint}".`,
    });
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
      text: {
        format: jsonSchemaFormat,
      },
      input: [
        { role: "system", content: systemInstruction },
        {
          role: "user",
          content: `Chief complaint: ${parsed.data.chiefComplaint}\n\nProvide pertinent positives and negatives addressing onset, duration, associated symptoms, modifying factors, and critical red flags. Include suggested investigations (if any), a concise assessment, and a clear plan.`,
        },
      ],
    });

    const textPayload = extractText(response);
    const history = parseHistory(textPayload);

    return NextResponse.json(history);
  } catch (error: unknown) {
    console.error("[history-route]", error);
    return NextResponse.json(
      {
        error: "Unable to generate history at this time.",
      },
      { status: 502 },
    );
  }
}

type OpenAIResponse = Awaited<
  ReturnType<OpenAI["responses"]["create"]>
>;

function extractText(response: OpenAIResponse) {
  if (!hasMessageOutput(response)) {
    throw new Error("OpenAI returned an unexpected payload.");
  }

  const message = response.output.find(
    (item): item is MessageOutput => item.type === "message",
  );

  if (!message) {
    throw new Error("No message content returned by OpenAI.");
  }

  const textBlock = message.content.find(
    (item): item is TextBlock => item.type === "output_text",
  );

  if (!textBlock?.text) {
    throw new Error("OpenAI response missing text output.");
  }

  return textBlock.text.trim();
}

function parseHistory(payload: string) {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(payload);
  } catch {
    throw new Error("OpenAI returned malformed JSON.");
  }

  const parsed = historyResponseSchema.safeParse(parsedJson);

  if (!parsed.success) {
    throw new Error("OpenAI returned an invalid payload.");
  }

  return parsed.data;
}

type MessageOutput = {
  type: "message";
  content: Array<TextBlock | { type: string }>;
};

type TextBlock = {
  type: "output_text";
  text: string;
};

function hasMessageOutput(
  response: OpenAIResponse,
): response is OpenAIResponse & { output: MessageOutput[] } {
  return (
    typeof response === "object" &&
    response !== null &&
    "output" in response &&
    Array.isArray(
      (response as { output?: unknown }).output,
    )
  );
}

