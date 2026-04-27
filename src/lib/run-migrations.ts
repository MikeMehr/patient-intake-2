/**
 * Runs all *.sql migration files in src/lib/migrations/ in alphabetical order.
 * Called from instrumentation.ts on every server startup.
 *
 * Connection strategy
 * -------------------
 * The app's DATABASE_URL user only has DML privileges (SELECT/INSERT/UPDATE/DELETE).
 * DDL operations (CREATE TABLE, ALTER TABLE) require an admin/superuser account.
 * Set MIGRATION_DATABASE_URL in Azure App Service environment variables to point
 * to the PostgreSQL admin user — migrations will use that connection.
 * If only DATABASE_URL is available, DDL-heavy early migrations will fail with
 * permission errors (42501) which are logged as warnings and skipped; the app
 * continues to start normally.
 *
 * Idempotency
 * -----------
 * All migrations must use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so they are
 * safe to re-run on every startup.
 */

import fs from "fs";
import path from "path";
import { Pool } from "pg";

export async function runMigrations(): Promise<void> {
  const connStr =
    process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;

  if (!connStr) {
    console.warn("[migrations] No DATABASE_URL configured — skipping.");
    return;
  }

  const migrationsDir = path.join(process.cwd(), "src", "lib", "migrations");

  let files: string[];
  try {
    files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    console.warn("[migrations] Migrations directory not found, skipping:", migrationsDir);
    return;
  }

  const pool = new Pool({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });

  let applied = 0;
  let skipped = 0;

  let client;
  try {
    client = await pool.connect();
  } catch (err: unknown) {
    const msg = (err as { message?: string }).message ?? String(err);
    console.error("[migrations] Cannot connect to DB — skipping migrations:", msg);
    await pool.end();
    return;
  }

  try {
    try {
      for (const file of files) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
        try {
          await client.query(sql);
          applied++;
        } catch (err: unknown) {
          const code = (err as { code?: string }).code;
          const msg = (err as { message?: string }).message ?? "";

          if (
            code === "42P07" || // duplicate_table
            msg.includes("already exists")
          ) {
            // Object already present — migration was applied previously.
            applied++;
          } else if (
            code === "42501" || // insufficient_privilege
            msg.includes("must be owner of") ||
            msg.includes("permission denied")
          ) {
            // App DB user lacks DDL privileges — this migration must be applied
            // by an admin. Set MIGRATION_DATABASE_URL to fix this automatically.
            skipped++;
            if (skipped === 1) {
              // Log once with actionable guidance, not once per migration.
              console.warn(
                "[migrations] DB user lacks DDL privileges. " +
                "Set MIGRATION_DATABASE_URL to an admin connection string in " +
                "Azure App Service → Configuration → App Settings to enable " +
                "automatic schema migrations."
              );
            }
          } else {
            console.error(`[migrations] Error in ${file}:`, msg);
          }
        }
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  console.log(
    `[migrations] Done — ${applied} applied, ${skipped} skipped (insufficient privileges).`
  );
}
