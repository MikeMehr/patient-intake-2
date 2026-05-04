/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.mjs");
pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve(
  "pdfjs-dist/legacy/build/pdf.worker.mjs"
);

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const doc = await loadingTask.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(
      content.items.map((item: any) => ("str" in item ? item.str : "")).join(" ")
    );
  }
  return pages.join("\n").trim();
}
