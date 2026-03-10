import { describe, expect, it } from "vitest";

import {
  lightCleanupTranscript,
  normalizePunctuation,
  stripLeadingTranscriptPunctuation,
} from "./speech-transcript";

describe("speech transcript helpers", () => {
  it("removes leading comma artifacts left behind after filler cleanup", () => {
    expect(lightCleanupTranscript("uh, no history of tobacco use")).toBe("no history of tobacco use");
  });

  it("drops leading punctuation before normalizing a transcript fragment", () => {
    expect(normalizePunctuation(", no history of tobacco use")).toBe("no history of tobacco use.");
  });

  it("preserves valid internal punctuation", () => {
    expect(normalizePunctuation("chest pain, shortness of breath")).toBe(
      "chest pain, shortness of breath.",
    );
  });

  it("strips repeated leading punctuation artifacts", () => {
    expect(stripLeadingTranscriptPunctuation(".,;: no history")).toBe("no history");
  });
});
