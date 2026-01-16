import { randomUUID } from "crypto";
import { logDebug } from "@/lib/secure-logger";

export function getRequestId(headers: Headers): string {
  return (
    headers.get("x-request-id") ||
    headers.get("x-correlation-id") ||
    randomUUID()
  );
}

export function logRequestMeta(
  route: string,
  requestId: string,
  status: number,
  durationMs: number,
) {
  logDebug("[request-meta]", { route, requestId, status, durationMs });
}



