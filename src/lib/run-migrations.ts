/**
 * Runs all *.sql migration files in src/lib/migrations/ in alphabetical order.
 * Called from instrumentation.ts on every server startup so the production
 * database is always up to date without any manual deploy step.
 *
 * Design constraints:
 * - All migrations must be idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
 * - This function never throws — errors are logged and execution continues so
 *   the server still starts even if an individual migration fails.
 */

import fs from "fs";
import path from "path";
import { query } from "@/lib/db";

export async function runMigrations(): Promise<void> {
  // In the Next.js standalone build process.cwd() resolves to the standalone
  // directory; Next.js traces the SQL files there at the same relative path.
  const migrationsDir = path.join(process.cwd(), "src", "lib", "migrations");

  let files: string[];
  try {
    files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort(); // 000_, 001_, … ensures correct order
  } catch {
    // Directory missing in unexpected environments — skip silently.
    console.warn("[migrations] Migrations directory not found, skipping:", migrationsDir);
    return;
  }

  let applied = 0;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    try {
      await query(sql);
      applied++;
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      const msg = (err as { message?: string }).message ?? "";
      if (code === "42P07" || msg.includes("already exists")) {
        // Object already exists — migration was previously applied, safe to skip.
        applied++;
      } else {
        // Log and continue — don't crash the server over a non-fatal migration error.
        console.error(`[migrations] Error in ${file}:`, msg);
      }
    }
  }

  console.log(`[migrations] Completed — ${applied}/${files.length} migration(s) processed.`);
}
