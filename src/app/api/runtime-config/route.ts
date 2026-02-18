import { NextResponse } from "next/server";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export const runtime = "nodejs";

/**
 * Runtime config for client-side feature flags.
 * This avoids relying solely on build-time NEXT_PUBLIC_* env var injection.
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  const status = 200;

  const useAzureStt =
    process.env.NEXT_PUBLIC_USE_AZURE_STT === "true" || process.env.USE_AZURE_STT === "true";
  const useAzureTts =
    process.env.NEXT_PUBLIC_USE_AZURE_TTS === "true" || process.env.USE_AZURE_TTS === "true";

  const res = NextResponse.json(
    {
      useAzureStt,
      useAzureTts,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
  logRequestMeta("/api/runtime-config", requestId, status, Date.now() - started);
  return res;
}

