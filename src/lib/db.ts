/**
 * PostgreSQL database connection and utilities
 * Uses connection pooling for performance
 * All queries use parameterized statements to prevent SQL injection
 */

import { Pool } from "pg";
import type { QueryResult, QueryResultRow } from "pg";
// Note: we intentionally avoid reading env at module import time.
// In some deployment environments (and during Next build), the runtime env may not
// be available when the module is evaluated. We create the pool lazily on first use.

function resolveDatabaseUrl(): string | undefined {
  // Primary expected name.
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  // Azure App Service sometimes exposes app settings with this prefix.
  if (process.env.APPSETTING_DATABASE_URL) return process.env.APPSETTING_DATABASE_URL;

  // If a value was configured as a Connection string, App Service can remap it.
  // (We still recommend setting DATABASE_URL as an Application setting.)
  if (process.env.CUSTOMCONNSTR_DATABASE_URL) return process.env.CUSTOMCONNSTR_DATABASE_URL;
  if (process.env.POSTGRESQLCONNSTR_DATABASE_URL) return process.env.POSTGRESQLCONNSTR_DATABASE_URL;

  return undefined;
}

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;

  const connectionString = resolveDatabaseUrl();
  if (!connectionString) {
    throw new Error(
      [
        "DATABASE_URL is not set.",
        "Set it in the runtime environment (e.g., Azure App Service -> Configuration -> Application settings).",
      ].join(" "),
    );
  }

  pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000, // Increased to 10 seconds
  });

  // Handle pool errors
  pool.on("error", (err) => {
    console.error("Unexpected error on idle client", err);
    // Don't exit process in development
    if (process.env.NODE_ENV === "production") {
      process.exit(-1);
    }
  });

  return pool;
}

/**
 * Execute a query with parameters (prevents SQL injection)
 */
export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const pool = getPool();

  const isTransientConnectionError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error || "");
    const code = typeof error === "object" && error && "code" in error ? String((error as any).code) : "";
    const lowered = message.toLowerCase();
    return (
      lowered.includes("connection terminated unexpectedly") ||
      lowered.includes("connection terminated due to connection timeout") ||
      lowered.includes("read etimedout") ||
      lowered.includes("econnreset") ||
      code === "ETIMEDOUT" ||
      code === "ECONNRESET" ||
      code === "57P01"
    );
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const start = Date.now();
    try {
      const res = await pool.query<T>(text, params);
      const duration = Date.now() - start;
      if (process.env.NODE_ENV === "development") {
        console.log("Executed query", { text, duration, rows: res.rowCount, attempt });
      }
      return res;
    } catch (error) {
      const shouldRetry = attempt === 1 && isTransientConnectionError(error);
      console.error("Database query error:", {
        attempt,
        shouldRetry,
        error,
      });
      if (!shouldRetry) {
        throw error;
      }
    }
  }

  throw new Error("Database query failed after retry.");
}

/**
 * Get a client from the pool for transactions
 */
export function getClient() {
  return getPool().connect();
}

/**
 * Initialize database schema
 * Run migrations to set up tables
 */
export async function initializeDatabase(): Promise<void> {
  try {
    // Read migration file
    const fs = await import("fs/promises");
    const path = await import("path");
    const migrationPath = path.join(process.cwd(), "src/lib/migrations/001_initial_schema.sql");
    const migrationSQL = await fs.readFile(migrationPath, "utf-8");

    // Execute migration
    await query(migrationSQL);
    console.log("Database schema initialized successfully");
  } catch (error) {
    console.error("Failed to initialize database:", error);
    throw error;
  }
}

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    await query("SELECT NOW()");
    return true;
  } catch (error) {
    console.error("Database connection test failed:", error);
    return false;
  }
}

export default pool;
