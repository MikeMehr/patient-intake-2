const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load .env.local if it exists
try {
  require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
} catch (e) {
  // dotenv not available, try manual parsing
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

if (!process.env.DATABASE_URL) {
  console.error("Error: DATABASE_URL environment variable is not set");
  console.log("Please set it in .env.local or export it");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function runAllMigrations() {
  const client = await pool.connect();
  try {
    const migrationsDir = path.join(__dirname, '../src/lib/migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // Run in order: 000, 001, 002, etc.

    console.log(`Found ${files.length} migration files\n`);

    for (const file of files) {
      console.log(`Running migration: ${file}...`);
      const migrationPath = path.join(migrationsDir, file);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
      
      try {
        await client.query(migrationSQL);
        console.log(`✓ ${file} completed\n`);
      } catch (error) {
        if (error.code === '42P07' || error.message.includes('already exists')) {
          console.log(`⚠ ${file} - Some objects already exist, continuing...\n`);
        } else {
          throw error;
        }
      }
    }
    
    console.log("✓ All migrations completed successfully!");
  } catch (error) {
    console.error("Error running migrations:", error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runAllMigrations()
  .then(() => {
    console.log("\nDatabase setup complete!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\nFailed:", error);
    process.exit(1);
  });

