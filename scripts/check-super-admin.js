const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function checkSuperAdmin() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, username, email, first_name, last_name FROM super_admin_users`
    );
    
    console.log(`Found ${result.rows.length} super admin user(s):`);
    result.rows.forEach((row, i) => {
      console.log(`\n${i + 1}. ID: ${row.id}`);
      console.log(`   Username: ${row.username}`);
      console.log(`   Email: ${row.email}`);
      console.log(`   Name: ${row.first_name} ${row.last_name}`);
    });
    
    // Test lookup
    const testUsername = "MehraeinAdmin";
    const lookup = await client.query(
      `SELECT id, username FROM super_admin_users WHERE username = $1`,
      [testUsername.toLowerCase().trim()]
    );
    console.log(`\nLookup test for "${testUsername}": ${lookup.rows.length > 0 ? 'FOUND' : 'NOT FOUND'}`);
    if (lookup.rows.length > 0) {
      console.log(`  Found username: ${lookup.rows[0].username}`);
    }
  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

checkSuperAdmin();
