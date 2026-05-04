import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

const MAX_IMAGES = 20;
const MAX_IMAGE_BASE64_LENGTH = 7_000_000;

interface WoundAnalysis {
  length: string;
  width: string;
  surfaceArea: string;
  borders: string;
  woundBase: string;
  woundBaseComposition: string;
  periwound: string;
  drainageType: string;
  signsOfInfection: string;
  stage: string;
  notes: string;
}

interface ImageInput {
  imageBase64: string;
  mimeType: string;
  analysis: WoundAnalysis | null;
}

function wrapText(text: string, maxWidth: number, font: import("pdf-lib").PDFFont, fontSize: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    const w = font.widthOfTextAtSize(test, fontSize);
    if (w > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  const session = await getCurrentSession();
  if (!session || session.userType !== "provider") {
    status = 401;
    const res = NextResponse.json({ error: "Authentication required." }, { status });
    logRequestMeta("/api/physician/transcription/wound-images-pdf", requestId, status, Date.now() - started);
    return res;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    status = 400;
    const res = NextResponse.json({ error: "Invalid JSON body." }, { status });
    logRequestMeta("/api/physician/transcription/wound-images-pdf", requestId, status, Date.now() - started);
    return res;
  }

  const { images, patientName } = (body || {}) as { images?: ImageInput[]; patientName?: string };

  if (!Array.isArray(images) || images.length === 0) {
    status = 400;
    const res = NextResponse.json({ error: "images array is required." }, { status });
    logRequestMeta("/api/physician/transcription/wound-images-pdf", requestId, status, Date.now() - started);
    return res;
  }

  const clampedImages = images.slice(0, MAX_IMAGES);
  const dateStr = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD

  try {
    const pdfDoc = await PDFDocument.create();
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const PAGE_W = 595;
    const PAGE_H = 842;
    const MARGIN = 40;
    const TEXT_W = PAGE_W - MARGIN * 2;
    const IMG_MAX_W = TEXT_W;
    const IMG_MAX_H = 460;

    for (let i = 0; i < clampedImages.length; i++) {
      const img = clampedImages[i];
      if (!img.imageBase64 || img.imageBase64.length > MAX_IMAGE_BASE64_LENGTH) continue;

      const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      let y = PAGE_H - MARGIN;

      // Header
      page.drawText("Wound Image Report", {
        x: MARGIN,
        y,
        size: 14,
        font: fontBold,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= 18;

      const headerParts = [`Image ${i + 1} of ${clampedImages.length}`, `Date: ${dateStr}`];
      if (patientName) headerParts.push(`Patient: ${patientName}`);
      page.drawText(headerParts.join("   •   "), {
        x: MARGIN,
        y,
        size: 9,
        font: fontRegular,
        color: rgb(0.4, 0.4, 0.4),
      });
      y -= 6;

      // Divider
      page.drawLine({
        start: { x: MARGIN, y },
        end: { x: PAGE_W - MARGIN, y },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.8),
      });
      y -= 16;

      // Embed image
      const imageBytes = Buffer.from(img.imageBase64, "base64");
      let embeddedImage;
      try {
        if (img.mimeType === "image/png") {
          embeddedImage = await pdfDoc.embedPng(imageBytes);
        } else {
          embeddedImage = await pdfDoc.embedJpg(imageBytes);
        }
      } catch {
        // Skip this image if embedding fails
        page.drawText("Image could not be embedded.", {
          x: MARGIN,
          y: y - 20,
          size: 10,
          font: fontRegular,
          color: rgb(0.6, 0.2, 0.2),
        });
        continue;
      }

      // Scale image to fit
      const { width: origW, height: origH } = embeddedImage;
      const scaleW = Math.min(1, IMG_MAX_W / origW);
      const scaleH = Math.min(1, IMG_MAX_H / origH);
      const scale = Math.min(scaleW, scaleH);
      const drawW = origW * scale;
      const drawH = origH * scale;
      const imgX = MARGIN + (IMG_MAX_W - drawW) / 2;

      page.drawImage(embeddedImage, { x: imgX, y: y - drawH, width: drawW, height: drawH });
      y -= drawH + 16;

      // Measurements section
      const analysis = img.analysis;
      if (analysis) {
        const drawLabel = (label: string, value: string, yPos: number): number => {
          if (!value || value === "—") return yPos;
          page.drawText(`${label}: `, { x: MARGIN, y: yPos, size: 9, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
          const labelW = fontBold.widthOfTextAtSize(`${label}: `, 9);
          const valLines = wrapText(value, TEXT_W - labelW, fontRegular, 9);
          page.drawText(valLines[0], { x: MARGIN + labelW, y: yPos, size: 9, font: fontRegular, color: rgb(0.1, 0.1, 0.1) });
          let nextY = yPos - 13;
          for (let li = 1; li < valLines.length; li++) {
            if (nextY < MARGIN) break;
            page.drawText(valLines[li], { x: MARGIN, y: nextY, size: 9, font: fontRegular, color: rgb(0.1, 0.1, 0.1) });
            nextY -= 13;
          }
          return nextY;
        };

        if (analysis.length !== "—" && analysis.width !== "—") {
          page.drawText(`Dimensions: ${analysis.length} cm × ${analysis.width} cm`, {
            x: MARGIN, y, size: 11, font: fontBold, color: rgb(0.1, 0.1, 0.4),
          });
          y -= 15;
        }
        if (analysis.surfaceArea && analysis.surfaceArea !== "—") {
          page.drawText(`Surface area: ${analysis.surfaceArea}`, {
            x: MARGIN, y, size: 9, font: fontRegular, color: rgb(0.2, 0.2, 0.2),
          });
          y -= 13;
        }

        y = drawLabel("Tissue composition", analysis.woundBaseComposition, y);
        y = drawLabel("Wound base", analysis.woundBase, y);
        y = drawLabel("Borders", analysis.borders, y);
        y = drawLabel("Periwound", analysis.periwound, y);
        y = drawLabel("Drainage", analysis.drainageType, y);
        y = drawLabel("Signs of infection", analysis.signsOfInfection, y);
        y = drawLabel("Stage", analysis.stage, y);

        if (analysis.notes && analysis.notes !== "—") {
          const noteLines = wrapText(analysis.notes, TEXT_W, fontRegular, 9);
          for (const line of noteLines) {
            if (y < MARGIN) break;
            page.drawText(line, { x: MARGIN, y, size: 9, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
            y -= 13;
          }
        }
      }
    }

    const pdfBytes = await pdfDoc.save();

    logRequestMeta("/api/physician/transcription/wound-images-pdf", requestId, status, Date.now() - started);
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="wound-images.pdf"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    status = 500;
    console.error("[wound-images-pdf] PDF generation failed:", err);
    const res = NextResponse.json({ error: "PDF generation failed." }, { status });
    logRequestMeta("/api/physician/transcription/wound-images-pdf", requestId, status, Date.now() - started);
    return res;
  }
}
