import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { generateAudioSasUrl } from "@/lib/azure-blob-audio";
import { getAudioBlobPath } from "@/lib/transcription-store";
import { transcribeWavBuffer } from "@/lib/azure-speech-transcribe";

export const maxDuration = 120;

const retranscribeSchema = z.object({
  soapVersionId: z.string().uuid(),
  language: z.string().trim().min(2).max(10),
});

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const auth = await getCurrentSession();
    if (!auth) {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required." }, { status });
      logRequestMeta("/api/physician/transcription/audio/retranscribe", requestId, status, Date.now() - started);
      return res;
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      status = 400;
      const res = NextResponse.json({ error: "Invalid JSON body." }, { status });
      logRequestMeta("/api/physician/transcription/audio/retranscribe", requestId, status, Date.now() - started);
      return res;
    }

    const parsed = retranscribeSchema.safeParse(body);
    if (!parsed.success) {
      status = 400;
      const res = NextResponse.json({ error: "Invalid request parameters." }, { status });
      logRequestMeta("/api/physician/transcription/audio/retranscribe", requestId, status, Date.now() - started);
      return res;
    }

    const { soapVersionId, language } = parsed.data;
    const physicianId = getEffectivePhysicianId(auth);

    const audioBlobPath = await getAudioBlobPath({ soapVersionId, physicianId });
    if (!audioBlobPath) {
      status = 404;
      const res = NextResponse.json({ error: "No saved audio found for this SOAP version." }, { status });
      logRequestMeta("/api/physician/transcription/audio/retranscribe", requestId, status, Date.now() - started);
      return res;
    }

    const sasUrl = await generateAudioSasUrl(audioBlobPath, 1);
    const audioRes = await fetch(sasUrl);
    if (!audioRes.ok) {
      throw new Error(`Failed to fetch audio blob: ${audioRes.status}`);
    }
    const wavBuffer = await audioRes.arrayBuffer();

    const { text, locale } = await transcribeWavBuffer({ wavBuffer, languageCode: language });

    const res = NextResponse.json({ text, language: locale });
    logRequestMeta("/api/physician/transcription/audio/retranscribe", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    const err = error as { statusCode?: number; details?: string; message?: string };
    status = err.statusCode ?? 500;
    console.error("[physician/transcription/audio/retranscribe] failed:", error);
    const res = NextResponse.json(
      { error: err.message || "Re-transcription failed." },
      { status },
    );
    logRequestMeta("/api/physician/transcription/audio/retranscribe", requestId, status, Date.now() - started);
    return res;
  }
}
