import { describe, expect, it } from "vitest";
import { assertValidPdfUpload } from "./invitation-pdf-summary";

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
