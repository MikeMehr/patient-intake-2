import { cleanupExpiredSessions } from "@/lib/session-store";
import { cleanupExpiredPhiRecords } from "@/lib/transcription-store";

const DEFAULT_INTERVAL_MINUTES = 15;

declare const global: typeof globalThis & {
  __sessionRetentionCleanupStarted?: boolean;
};

async function runCleanup() {
  try {
    const deletedSessions = await cleanupExpiredSessions();
    if (deletedSessions > 0) {
      console.info("[phi-retention-cleanup] Removed expired patient sessions", { deletedSessions });
    }
  } catch (error) {
    console.error("[phi-retention-cleanup] Failed to cleanup patient sessions", {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const counts = await cleanupExpiredPhiRecords();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total > 0) {
      console.info("[phi-retention-cleanup] Removed expired PHI records", counts);
    }
  } catch (error) {
    console.error("[phi-retention-cleanup] Failed to cleanup PHI records", {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

export function startSessionRetentionCleanup() {
  if (global.__sessionRetentionCleanupStarted) return;
  global.__sessionRetentionCleanupStarted = true;

  void runCleanup();

  const intervalMinutes =
    Number(process.env.SESSION_RETENTION_CLEANUP_INTERVAL_MINUTES) || DEFAULT_INTERVAL_MINUTES;
  const intervalMs = Math.max(intervalMinutes, 1) * 60 * 1000;

  setInterval(() => {
    void runCleanup();
  }, intervalMs);
}
