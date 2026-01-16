const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function testPassword() {
  const client = await pool.connect();
  try {
    const username = "MehraeinAdmin";
    const password = "Pizza1212$";
    
    const result = await client.query(
      `SELECT id, username, password_hash FROM super_admin_users WHERE username = $1`,
      [username.toLowerCase().trim()]
    );
    
    if (result.rows.length === 0) {
      console.log("User not found");
      return;
    }
    
    const user = result.rows[0];
    console.log(`Found user: ${user.username}`);
    console.log(`Password hash: ${user.password_hash.substring(0, 20)}...`);
    
    const isValid = await bcrypt.compare(password, user.password_hash);
    console.log(`Password verification: ${isValid ? 'VALID' : 'INVALID'}`);
    
    // Test with different variations
    console.log("\nTesting password variations:");
    console.log(`"${password}": ${await bcrypt.compare(password, user.password_hash)}`);
    console.log(`"${password} " (with space): ${await bcrypt.compare(password + " ", user.password_hash)}`);
    console.log(`" ${password}" (space before): ${await bcrypt.compare(" " + password, user.password_hash)}`);
    
  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

testPassword();
