import { afterEach, describe, expect, it, vi } from "vitest";
import { assertValidPdfUpload, extractPdfTextWithAzureDocumentIntelligence } from "./invitation-pdf-summary";

function makeFile(options: { name: string; type: string; size: number }): File {
  const payload = new Uint8Array(options.size);
  return new File([payload], options.name, { type: options.type });
}

describe("assertValidPdfUpload", () => {
  it("accepts valid PDF uploads", () => {
    const file = makeFile({
      name: "lab-report.pdf",
      type: "application/pdf",
      size: 1024,
    });
    expect(() => assertValidPdfUpload(file, "labReport")).not.toThrow();
  });

  it("rejects non-pdf uploads", () => {
    const file = makeFile({
      name: "lab-report.txt",
      type: "text/plain",
      size: 1024,
    });
    expect(() => assertValidPdfUpload(file, "labReport")).toThrow(/Invalid file type/i);
  });

  it("rejects files larger than 10mb", () => {
    const file = makeFile({
      name: "large-lab-report.pdf",
      type: "application/pdf",
      size: 10 * 1024 * 1024 + 1,
    });
    expect(() => assertValidPdfUpload(file, "labReport")).toThrow(/exceeds 10MB/i);
  });
});

describe("extractPdfTextWithAzureDocumentIntelligence", () => {
  const originalEndpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const originalKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_API_KEY;

  afterEach(() => {
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = originalEndpoint;
    process.env.AZURE_DOCUMENT_INTELLIGENCE_API_KEY = originalKey;
    vi.restoreAllMocks();
  });

  it("rejects operation locations that change host origin", async () => {
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = "https://eastus.api.cognitive.microsoft.com";
    process.env.AZURE_DOCUMENT_INTELLIGENCE_API_KEY = "test-key";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        status: 202,
        headers: {
          "operation-location": "https://westus.api.cognitive.microsoft.com/operations/abc",
        },
      }),
    );

    const file = makeFile({ name: "lab-report.pdf", type: "application/pdf", size: 1024 });
    await expect(extractPdfTextWithAzureDocumentIntelligence(file)).rejects.toThrow(
      /does not match configured endpoint/i,
    );
  });
});
