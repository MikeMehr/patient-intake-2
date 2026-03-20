/**
 * Fills an uploaded form PDF with patient answers extracted from the interview.
 *
 * Strategy:
 * 1. Load the original PDF with pdf-lib.
 * 2. If the PDF has interactive AcroForm fields, fuzzy-match each field to a
 *    form answer and fill it.
 * 3. For flat PDFs (no AcroForm), overlay answers at field locations detected
 *    by Azure Document Intelligence.
 * 4. Always append a "Completed Patient Responses" page with all Q&A pairs so
 *    there is a clear, human-readable record regardless of whether step 2/3 ran.
 */

import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFName,
  PDFString,
  rgb,
  StandardFonts,
} from "pdf-lib";

export interface FormAnswer {
  question: string;
  answer: string;
}

export interface FilledFormMetadata {
  patientName: string;
  sessionDate: Date;
  originalFilename: string | null;
}

/** A detected field position from Document Intelligence layout analysis. */
export interface FieldLocation {
  keyText: string;
  pageIndex: number; // 0-based
  x: number;         // PDF points from left
  y: number;         // PDF points from bottom
  width: number;     // PDF points
  height: number;    // PDF points
}

/**
 * Sanitise a filename for use in Content-Disposition headers.
 * Strips path separators, non-ASCII chars, and limits length.
 */
export function sanitiseFilename(name: string): string {
  return name
    .replace(/[/\\]/g, "-")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/"/g, "'")
    .slice(0, 200)
    .trim() || "form.pdf";
}

/**
 * Jaccard-style word-overlap score between two strings.
 * Tokenises on whitespace and common field-name separators.
 */
function overlapScore(a: string, b: string): number {
  const tokenise = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[\s\-_.,()/]+/)
        .filter((t) => t.length > 1),
    );
  const setA = tokenise(a);
  const setB = tokenise(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  return intersection / Math.max(setA.size, setB.size);
}

/**
 * Find the best-matching FormAnswer for a given AcroForm field name/tooltip.
 * Returns null if no match exceeds the threshold.
 */
function findBestMatch(
  fieldLabel: string,
  answers: FormAnswer[],
  threshold = 0.2,
): FormAnswer | null {
  let best: FormAnswer | null = null;
  let bestScore = 0;
  for (const qa of answers) {
    const score = overlapScore(fieldLabel, qa.question);
    if (score > bestScore) {
      bestScore = score;
      best = qa;
    }
  }
  return bestScore >= threshold ? best : null;
}

/**
 * Extract all text-type AcroForm fields from a PDF, returning their names and
 * any human-readable alternative text (tooltip / TU entry).
 * Returns an empty array if the PDF has no AcroForm or no text fields.
 */
export async function extractAcroTextFields(
  pdfBytes: Buffer,
): Promise<{ name: string; tooltip: string }[]> {
  try {
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const fields = form.getFields();
    const results: { name: string; tooltip: string }[] = [];
    for (const field of fields) {
      if (!(field instanceof PDFTextField)) continue;
      const name = field.getName();
      // Try to get the human-readable alternative text (TU / tooltip entry)
      let tooltip = name;
      try {
        const tuEntry = field.acroField.dict.lookup(PDFName.of("TU"));
        if (tuEntry instanceof PDFString) {
          const decoded = tuEntry.decodeText();
          if (decoded?.trim()) tooltip = decoded.trim();
        }
      } catch {
        // No tooltip — fall back to field name
      }
      results.push({ name, tooltip });
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Pre-computed AI mapping of AcroForm field name → answer text.
 * When provided, takes priority over the built-in fuzzy matcher.
 */
export interface AcroFieldMapping {
  fieldName: string;
  answer: string;
}

/**
 * Build a filled PDF from the original form bytes and the patient's answers.
 */
export async function buildFilledFormPdf(params: {
  pdfBytes: Buffer;
  formAnswers: FormAnswer[];
  metadata: FilledFormMetadata;
  fieldLocations?: FieldLocation[];
  /** AI-computed field→answer mappings for AcroForm PDFs. When supplied, the
   *  built-in fuzzy matcher is skipped and these are used directly. */
  acroFieldMappings?: AcroFieldMapping[];
}): Promise<Uint8Array> {
  const { pdfBytes, formAnswers, metadata, fieldLocations, acroFieldMappings } = params;

  // --- 1. Load the original PDF ---
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  } catch {
    // Corrupt or unreadable — start fresh (response page only)
    pdfDoc = await PDFDocument.create();
  }

  // --- 2. Fill AcroForm fields if present ---
  try {
    const form = pdfDoc.getForm();
    const fields = form.getFields();

    if (fields.length > 0) {
      // Build a fast lookup from field name → answer when AI mappings are provided
      const aiMap = new Map<string, string>(
        (acroFieldMappings || []).map((m) => [m.fieldName, m.answer]),
      );
      const useAiMap = aiMap.size > 0;

      for (const field of fields) {
        const fieldName = field.getName();

        // Resolve answer: prefer AI mapping, fall back to fuzzy match
        let answerText: string | null = null;
        if (useAiMap) {
          answerText = aiMap.get(fieldName) ?? null;
        } else {
          const match = findBestMatch(fieldName, formAnswers);
          answerText = match?.answer ?? null;
        }
        if (!answerText) continue;

        try {
          if (field instanceof PDFTextField) {
            field.setText(answerText);
          } else if (field instanceof PDFCheckBox) {
            const val = answerText.trim().toLowerCase();
            if (val === "yes" || val === "true" || val === "checked") {
              field.check();
            }
          } else if (field instanceof PDFRadioGroup) {
            // Best-effort: try to select an option whose label matches the answer
            const options = field.getOptions();
            const answerLower = answerText.trim().toLowerCase();
            const matchedOption = options.find((o) =>
              o.toLowerCase().includes(answerLower) || answerLower.includes(o.toLowerCase()),
            );
            if (matchedOption) field.select(matchedOption);
          }
        } catch {
          // Skip read-only or malformed fields silently
        }
      }

      // Flatten form to bake in the filled values
      try {
        form.flatten();
      } catch {
        // Non-fatal — leave form interactive if flatten fails
      }
    }
  } catch {
    // PDF has no AcroForm or it's malformed — fall through to overlay / response page
  }

  // --- 2b. Overlay answers at detected field locations (for flat PDFs) ---
  // Each FieldLocation's keyText contains the ANSWER text to draw (pre-mapped by AI).
  if (fieldLocations && fieldLocations.length > 0) {
    const overlayFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    for (const loc of fieldLocations) {
      if (loc.pageIndex < 0 || loc.pageIndex >= pages.length) continue;

      const answer = loc.keyText?.trim();
      if (!answer) continue;

      const targetPage = pages[loc.pageIndex];
      // Use a comfortable readable size; loc.height is the maximum available space
      const fontSize = Math.max(8, Math.min(10, loc.height * 0.6));
      const lineHeight = fontSize * 1.35;
      const PADDING = 3; // pts top & bottom inside the box
      const maxWidth = loc.width - 6;

      // ── 1. Wrap text first so we know the actual height needed ──────────
      const words = answer.split(" ");
      const lines: string[] = [];
      let current = "";
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (overlayFont.widthOfTextAtSize(candidate, fontSize) > maxWidth && current) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      if (current) lines.push(current);

      // ── 2. Size the box to exactly fit the text (no wasted white space) ─
      const actualHeight = lines.length * lineHeight + PADDING * 2;
      // Anchor the box at the top of the available area (loc.y + loc.height = top)
      const boxY = loc.y + loc.height - actualHeight;

      // Erase existing content only over the area we actually use
      targetPage.drawRectangle({
        x: loc.x,
        y: boxY,
        width: loc.width,
        height: actualHeight,
        color: rgb(1, 1, 1),
        borderColor: rgb(0.75, 0.82, 0.92),
        borderWidth: 0.5,
      });

      // ── 3. Draw each line top-to-bottom inside the box ──────────────────
      let textY = boxY + actualHeight - PADDING - fontSize;
      for (const line of lines) {
        if (textY < boxY) break;
        targetPage.drawText(line, {
          x: loc.x + 3,
          y: textY,
          size: fontSize,
          font: overlayFont,
          color: rgb(0.0, 0.1, 0.5),
        });
        textY -= lineHeight;
      }
    }
  }

  // --- 3. Append "Completed Patient Responses" page(s) ---
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_WIDTH = 595; // A4 points
  const PAGE_HEIGHT = 842;
  const MARGIN = 50;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
  const FONT_SIZE_TITLE = 14;
  const FONT_SIZE_SUB = 9;
  const FONT_SIZE_Q = 10;
  const FONT_SIZE_A = 10;
  const LINE_HEIGHT_Q = 14;
  const LINE_HEIGHT_A = 13;
  const QA_GAP = 10; // space between Q&A pairs
  const BOX_PADDING = 6;
  const BOTTOM_MARGIN = 60;

  const dateStr = metadata.sessionDate.toLocaleDateString("en-CA"); // YYYY-MM-DD

  /** Wrap text to fit within maxWidth, returning an array of lines */
  function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
    const words = text.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      const width = font.widthOfTextAtSize(candidate, fontSize);
      if (width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines.length > 0 ? lines : [""];
  }

  // Measure total height needed for one Q&A block
  function measureBlock(qa: FormAnswer, index: number): number {
    const qLabel = `${index + 1}. ${qa.question}`;
    const qLines = wrapText(qLabel, FONT_SIZE_Q, CONTENT_WIDTH - BOX_PADDING * 2);
    const aLines = wrapText(qa.answer || "—", FONT_SIZE_A, CONTENT_WIDTH - BOX_PADDING * 2 - 8);
    const qHeight = BOX_PADDING * 2 + qLines.length * LINE_HEIGHT_Q;
    const aHeight = aLines.length * LINE_HEIGHT_A + 4;
    return qHeight + aHeight + QA_GAP;
  }

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  // Page header
  page.drawText("Completed Patient Responses", {
    x: MARGIN,
    y,
    size: FONT_SIZE_TITLE,
    font: fontBold,
    color: rgb(0.11, 0.18, 0.24),
  });
  y -= 18;

  const subLine = `Patient: ${metadata.patientName}  |  Date: ${dateStr}`;
  page.drawText(subLine, {
    x: MARGIN,
    y,
    size: FONT_SIZE_SUB,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= 6;

  // Separator line
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8),
  });
  y -= 16;

  // Draw each Q&A block
  for (let i = 0; i < formAnswers.length; i++) {
    const qa = formAnswers[i];
    const blockHeight = measureBlock(qa, i);

    // New page if needed
    if (y - blockHeight < BOTTOM_MARGIN) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }

    const qLabel = `${i + 1}. ${qa.question}`;
    const qLines = wrapText(qLabel, FONT_SIZE_Q, CONTENT_WIDTH - BOX_PADDING * 2);
    const qBoxHeight = BOX_PADDING * 2 + qLines.length * LINE_HEIGHT_Q;

    // Question box (light grey background)
    page.drawRectangle({
      x: MARGIN,
      y: y - qBoxHeight,
      width: CONTENT_WIDTH,
      height: qBoxHeight,
      color: rgb(0.95, 0.96, 0.97),
      borderColor: rgb(0.85, 0.87, 0.89),
      borderWidth: 0.5,
    });

    // Question text
    let textY = y - BOX_PADDING - LINE_HEIGHT_Q + 3;
    for (const line of qLines) {
      page.drawText(line, {
        x: MARGIN + BOX_PADDING,
        y: textY,
        size: FONT_SIZE_Q,
        font: fontBold,
        color: rgb(0.18, 0.25, 0.35),
      });
      textY -= LINE_HEIGHT_Q;
    }
    y -= qBoxHeight;

    // Answer text
    const aLines = wrapText(qa.answer || "—", FONT_SIZE_A, CONTENT_WIDTH - BOX_PADDING * 2 - 8);
    y -= 4;
    for (const line of aLines) {
      page.drawText(line, {
        x: MARGIN + BOX_PADDING + 8,
        y,
        size: FONT_SIZE_A,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= LINE_HEIGHT_A;
    }

    y -= QA_GAP;
  }

  return pdfDoc.save();
}
