import { cleanupExpiredSessions } from "@/lib/session-store";

const DEFAULT_INTERVAL_MINUTES = 15;

declare const global: typeof globalThis & {
  __sessionRetentionCleanupStarted?: boolean;
};

async function runCleanup() {
  try {
    const deletedCount = await cleanupExpiredSessions();
    if (deletedCount > 0) {
      console.info("[session-retention-cleanup] Removed expired sessions", { deletedCount });
    }
  } catch (error) {
    console.error("[session-retention-cleanup] Failed to cleanup sessions", {
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
