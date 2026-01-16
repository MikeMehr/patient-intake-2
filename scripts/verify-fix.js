const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function verify() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT column_name, is_nullable, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'physician_sessions' AND column_name = 'physician_id'
    `);
    
    if (result.rows.length > 0) {
      console.log("physician_id column:", result.rows[0]);
      if (result.rows[0].is_nullable === 'YES') {
        console.log("✓ physician_id is now nullable - fix successful!");
      } else {
        console.log("✗ physician_id is still NOT NULL");
      }
    }
  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

verify();
