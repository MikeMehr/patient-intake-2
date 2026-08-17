import { describe, expect, it } from "vitest";
import type OpenAI from "openai";
import {
  buildContentFilterPayload,
  categoriesFromApiError,
  categoriesFromChoice,
  isContentFilterError,
  locateFlaggedSegments,
} from "./content-filter";

const azure400Error = Object.assign(new Error("400 content_filter"), {
  status: 400,
  error: {
    code: "content_filter",
    innererror: {
      code: "ResponsibleAIPolicyViolation",
      content_filter_result: {
        hate: { filtered: false, severity: "safe" },
        self_harm: { filtered: true, severity: "medium" },
        sexual: { filtered: false, severity: "safe" },
        violence: { filtered: false, severity: "safe" },
      },
    },
  },
});

function fakeClient(flaggedSnippet: string): OpenAI {
  return {
    chat: {
      completions: {
        create: async ({ messages }: { messages: Array<{ content: string }> }) => {
          if (messages[0].content.includes(flaggedSnippet)) throw azure400Error;
          return { choices: [{ finish_reason: "stop", message: { content: "" } }] };
        },
      },
    },
  } as unknown as OpenAI;
}

describe("categoriesFromApiError", () => {
  it("extracts only the tripped categories with severity", () => {
    expect(categoriesFromApiError(azure400Error)).toEqual([{ category: "self_harm", severity: "medium" }]);
  });

  it("returns empty for non-filter errors", () => {
    expect(categoriesFromApiError(new Error("boom"))).toEqual([]);
  });
});

describe("categoriesFromChoice", () => {
  it("reads content_filter_results from a filtered choice", () => {
    const choice = {
      finish_reason: "content_filter",
      content_filter_results: {
        violence: { filtered: true, severity: "high" },
        self_harm: { filtered: false, severity: "safe" },
      },
    };
    expect(categoriesFromChoice(choice)).toEqual([{ category: "violence", severity: "high" }]);
  });
});

describe("isContentFilterError", () => {
  it("recognises Azure RAI blocks", () => {
    expect(isContentFilterError(azure400Error)).toBe(true);
    expect(isContentFilterError(new Error("some other 400"))).toBe(false);
  });
});

describe("locateFlaggedSegments", () => {
  it("pinpoints the paragraph that trips the filter", async () => {
    const transcript = [
      "Patient reports three days of foot pain and swelling.",
      "I feel like I got to die with pain, it is unbearable.",
      "Plan is to send a photo and follow up this afternoon.",
    ].join("\n\n");
    const segments = await locateFlaggedSegments(transcript, fakeClient("die with pain"), "gpt-test");
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toContain("die with pain");
    expect(segments[0].categories).toEqual([{ category: "self_harm", severity: "medium" }]);
    // Offsets point back into the original transcript
    expect(transcript.slice(segments[0].start, segments[0].end)).toContain("die with pain");
  });

  it("returns empty when no single paragraph trips it", async () => {
    const transcript = "Patient reports foot pain.\n\nPlan: ice and rest.";
    const segments = await locateFlaggedSegments(transcript, fakeClient("never-matches"), "gpt-test");
    expect(segments).toEqual([]);
  });
});

describe("buildContentFilterPayload", () => {
  it("names the category and offers generate-anyway when a passage is found", async () => {
    const transcript = "Normal paragraph here.\n\nI feel like I got to die with pain today.";
    const payload = await buildContentFilterPayload({
      transcript,
      categories: [{ category: "self_harm", severity: "medium" }],
      client: fakeClient("die with pain"),
      deployment: "gpt-test",
    });
    expect(payload.error).toContain("self-harm (medium severity)");
    expect(payload.error).toContain("generate anyway");
    expect(payload.contentFilter.segments).toHaveLength(1);
  });

  it("explains when no passage could be pinpointed", async () => {
    const payload = await buildContentFilterPayload({
      transcript: "Normal paragraph here.",
      categories: [{ category: "violence", severity: "high" }],
      client: fakeClient("never-matches"),
      deployment: "gpt-test",
    });
    expect(payload.error).toContain("violence (high severity)");
    expect(payload.error).toContain("No single passage could be pinpointed");
    expect(payload.contentFilter.segments).toEqual([]);
  });
});
