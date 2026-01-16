const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Get migration file from command line argument
const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error("Usage: node scripts/run-single-migration.js <migration-file.sql>");
  process.exit(1);
}

// Load .env.local if it exists
try {
  require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
} catch (e) {
  // Try manual parsing
  try {
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
  } catch (readError) {
    // File exists but can't be read
  }
}

if (!process.env.DATABASE_URL) {
  console.error("Error: DATABASE_URL environment variable is not set");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function runMigration() {
  const client = await pool.connect();
  try {
    const migrationPath = path.join(__dirname, '../src/lib/migrations', migrationFile);
    
    if (!fs.existsSync(migrationPath)) {
      console.error(`Migration file not found: ${migrationPath}`);
      process.exit(1);
    }

    console.log(`Running migration: ${migrationFile}...`);
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
    
    await client.query(migrationSQL);
    console.log(`✓ ${migrationFile} completed successfully!`);
  } catch (error) {
    if (error.code === '42P07' || error.message.includes('already exists')) {
      console.log(`⚠ ${migrationFile} - Some objects already exist, continuing...`);
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

