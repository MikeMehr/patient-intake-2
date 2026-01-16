const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function fixConstraint() {
  const client = await pool.connect();
  try {
    console.log("Making physician_id nullable in physician_sessions table...");
    
    // Drop the NOT NULL constraint if it exists
    await client.query(`
      ALTER TABLE physician_sessions 
      ALTER COLUMN physician_id DROP NOT NULL
    `);
    
    console.log("✓ Constraint fixed - physician_id is now nullable");
  } catch (error) {
    if (error.code === '42704') {
      console.log("Constraint doesn't exist or already nullable");
    } else {
      console.error("Error:", error.message);
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

fixConstraint()
  .then(() => {
    console.log("Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed:", error);
    process.exit(1);
  });
