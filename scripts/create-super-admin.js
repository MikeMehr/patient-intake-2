/**
 * Script to create initial super admin user
 * Run with: DATABASE_URL="your_db_url" node scripts/create-super-admin.js
 * Or set SUPER_ADMIN_USERNAME, SUPER_ADMIN_PASSWORD, etc. as env vars
 */

const { Pool } = require('pg');
const bcrypt = require('bcrypt');

// Read from environment or use defaults
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Error: DATABASE_URL environment variable is required");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function createSuperAdmin() {
  const client = await pool.connect();
  try {
    const username = process.env.SUPER_ADMIN_USERNAME || "MehraeinAdmin";
    const password = process.env.SUPER_ADMIN_PASSWORD || "Pizza1212$";
    const email = process.env.SUPER_ADMIN_EMAIL || "mehraein@yahoo.com";
    const firstName = process.env.SUPER_ADMIN_FIRST_NAME || "Super";
    const lastName = process.env.SUPER_ADMIN_LAST_NAME || "Admin";

    console.log(`Creating super admin with username: ${username}`);

    // Check if super admin already exists
    const existing = await client.query(
      `SELECT id FROM super_admin_users WHERE username = $1 OR email = $1`,
      [username.toLowerCase().trim()]
    );

    if (existing.rows.length > 0) {
      console.log("Super admin user already exists");
      return;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create super admin
    const result = await client.query(
      `INSERT INTO super_admin_users (username, password_hash, email, first_name, last_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        username.toLowerCase().trim(),
        passwordHash,
        email.toLowerCase().trim(),
        firstName.trim(),
        lastName.trim(),
      ]
    );

    console.log(`✓ Super admin user created successfully!`);
    console.log(`  Username: ${username}`);
    console.log(`  Email: ${email}`);
    console.log(`  ID: ${result.rows[0].id}`);
  } catch (error) {
    console.error("Error creating super admin:", error.message);
    if (error.code === '42P01') {
      console.error("Error: super_admin_users table does not exist. Please run the database migration first.");
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

createSuperAdmin()
  .then(() => {
    console.log("Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed to create super admin:", error);
    process.exit(1);
  });
