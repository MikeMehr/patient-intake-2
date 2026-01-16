/**
 * PostgreSQL database connection and utilities
 * Uses connection pooling for performance
 * All queries use parameterized statements to prevent SQL injection
 */

import { Pool } from "pg";
import type { QueryResult, QueryResultRow } from "pg";
import { ensureProdEnv } from "@/lib/required-env";

// Ensure required env in production
ensureProdEnv(["DATABASE_URL"]);

// Create connection pool (only if DATABASE_URL is set)
if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set. Set it in .env.local (e.g., postgresql://user:pass@host:5432/dbname).",
  );
}

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000, // Increased to 10 seconds
    })
  : null;

// Handle pool errors
if (pool) {
  pool.on("error", (err) => {
    console.error("Unexpected error on idle client", err);
    // Don't exit process in development
    if (process.env.NODE_ENV === "production") {
      process.exit(-1);
    }
  });
}

/**
 * Execute a query with parameters (prevents SQL injection)
 */
export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  if (!pool) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  const start = Date.now();
  try {
    const res = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === "development") {
      console.log("Executed query", { text, duration, rows: res.rowCount });
    }
    return res;
  } catch (error) {
    console.error("Database query error:", error);
    throw error;
  }
}

/**
 * Get a client from the pool for transactions
 */
export function getClient() {
  if (!pool) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return pool.connect();
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
