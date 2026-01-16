import { query } from "@/lib/db";

const DEFAULT_INTERVAL_MINUTES = 15;
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

// Avoid multiple intervals in hot-reload / multi-import scenarios
declare const global: typeof globalThis & {
  __invitationCleanupStarted?: boolean;
};

async function runCleanup() {
  try {
    await query(
      `DELETE FROM patient_invitations
       WHERE COALESCE(sent_at, created_at, NOW()) < NOW() - INTERVAL '4 hours'`,
    );
  } catch (error) {
    console.error("[invitations-cleanup] Failed to delete old invitations", error);
  }
}

export function startInvitationCleanup() {
  if (global.__invitationCleanupStarted) return;
  global.__invitationCleanupStarted = true;

  // Fire once on boot
  void runCleanup();

  const intervalMinutes =
    Number(process.env.INVITATION_CLEANUP_INTERVAL_MINUTES) || DEFAULT_INTERVAL_MINUTES;
  const intervalMs = Math.max(intervalMinutes, 1) * 60 * 1000;

  setInterval(() => {
    void runCleanup();
  }, intervalMs);
}

