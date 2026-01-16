const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log("Running migration 002_organizations_schema.sql...");
    const migrationPath = path.join(__dirname, '../src/lib/migrations/002_organizations_schema.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
    
    await client.query(migrationSQL);
    console.log("✓ Migration completed successfully!");
  } catch (error) {
    if (error.code === '42P07') {
      console.log("Tables already exist, skipping...");
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
