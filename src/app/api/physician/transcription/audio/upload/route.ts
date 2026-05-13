import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { uploadAudioBlob } from "@/lib/azure-blob-audio";
import { updateAudioBlobPath } from "@/lib/transcription-store";

export const maxDuration = 120;

const MAX_AUDIO_SIZE_BYTES = 100 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const auth = await getCurrentSession();
    if (!auth) {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required." }, { status });
      logRequestMeta("/api/physician/transcription/audio/upload", requestId, status, Date.now() - started);
      return res;
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      status = 400;
      const res = NextResponse.json({ error: "Invalid form data." }, { status });
      logRequestMeta("/api/physician/transcription/audio/upload", requestId, status, Date.now() - started);
      return res;
    }

    const audio = formData.get("audio");
    const rawSoapVersionId = formData.get("soapVersionId");

    const idParse = z.string().uuid().safeParse(rawSoapVersionId);
    if (!idParse.success) {
      status = 400;
      const res = NextResponse.json({ error: "Invalid soapVersionId." }, { status });
      logRequestMeta("/api/physician/transcription/audio/upload", requestId, status, Date.now() - started);
      return res;
    }
    const soapVersionId = idParse.data;

    if (!(audio instanceof File)) {
      status = 400;
      const res = NextResponse.json({ error: "No audio file provided." }, { status });
      logRequestMeta("/api/physician/transcription/audio/upload", requestId, status, Date.now() - started);
      return res;
    }

    if (audio.size <= 0 || audio.size > MAX_AUDIO_SIZE_BYTES) {
      status = 400;
      const res = NextResponse.json({ error: "Audio file is empty or exceeds the 100MB limit." }, { status });
      logRequestMeta("/api/physician/transcription/audio/upload", requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = getEffectivePhysicianId(auth);
    const blobName = `audio/${soapVersionId}.wav`;
    const wavBuffer = Buffer.from(await audio.arrayBuffer());

    await uploadAudioBlob({ blobName, wavBuffer });
    await updateAudioBlobPath({ soapVersionId, physicianId, audioBlobPath: blobName });

    const res = NextResponse.json({ audioBlobPath: blobName });
    logRequestMeta("/api/physician/transcription/audio/upload", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[physician/transcription/audio/upload] failed:", error);
    const res = NextResponse.json({ error: "Failed to save audio recording." }, { status });
    logRequestMeta("/api/physician/transcription/audio/upload", requestId, status, Date.now() - started);
    return res;
  }
}
