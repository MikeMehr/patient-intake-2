// Load environment variables first
try {
  require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
} catch (e) {
  // dotenv not available, try manual parsing
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '../.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf-8');
    envFile.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const match = trimmed.match(/^([^=:#]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          let value = match[2].trim();
          // Remove quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    });
  }
}

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

if (!process.env.DATABASE_URL) {
  console.error("Error: DATABASE_URL environment variable is not set");
  console.log("Please set it in .env.local or export it with: export DATABASE_URL='your_database_connection_string'");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log("Running migration 004_add_previous_lab_report_summary.sql...");
    const migrationPath = path.join(__dirname, '../src/lib/migrations/004_add_previous_lab_report_summary.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
    
    await client.query(migrationSQL);
    console.log("✓ Migration completed successfully!");
    console.log("✓ Added previous_lab_report_summary column to patient_invitations table");
  } catch (error) {
    if (error.code === '42701') {
      console.log("Column already exists, skipping...");
    } else {
      console.error("Error running migration:", error.message);
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration()
  .then(() => {
    console.log("Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed:", error);
    process.exit(1);
  });















