/**
 * Script to create an org admin user for a given organization.
 * Run with: node scripts/create-org-admin.js
 *
 * Set env vars to override defaults:
 *   ORG_ADMIN_USERNAME, ORG_ADMIN_PASSWORD, ORG_ADMIN_EMAIL,
 *   ORG_ADMIN_FIRST_NAME, ORG_ADMIN_LAST_NAME, ORG_NAME (partial match)
 */

const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

// Load .env.local
try {
  const envPath = path.join(__dirname, '../.env.local');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
      const m = line.trim().match(/^([^=#]+)=(.*)/);
      if (m && !process.env[m[1].trim()]) {
        let val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[m[1].trim()] = val;
      }
    });
  }
} catch {}

if (!process.env.DATABASE_URL) {
  console.error("Error: DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function createOrgAdmin() {
  const client = await pool.connect();
  try {
    const orgName    = process.env.ORG_NAME        || "MyMD Medical Clinic";
    const username   = process.env.ORG_ADMIN_USERNAME  || "mymd-admin";
    const password   = process.env.ORG_ADMIN_PASSWORD  || "MyMD-Admin-2026!";
    const email      = process.env.ORG_ADMIN_EMAIL     || "mymd.burnaby@gmail.com";
    const firstName  = process.env.ORG_ADMIN_FIRST_NAME || "Clinic";
    const lastName   = process.env.ORG_ADMIN_LAST_NAME  || "Admin";

    // Find the organization
    const orgResult = await client.query(
      `SELECT id, name FROM organizations WHERE name ILIKE $1 LIMIT 1`,
      [`%${orgName}%`]
    );

    if (orgResult.rows.length === 0) {
      console.error(`No organization found matching: "${orgName}"`);
      console.error("Available organizations:");
      const all = await client.query("SELECT name FROM organizations ORDER BY name");
      all.rows.forEach(r => console.error(" -", r.name));
      process.exit(1);
    }

    const org = orgResult.rows[0];
    console.log(`Found organization: ${org.name} (${org.id})`);

    // Check if already exists
    const existing = await client.query(
      `SELECT id FROM organization_users WHERE username = $1 OR email = $2`,
      [username.toLowerCase().trim(), email.toLowerCase().trim()]
    );

    if (existing.rows.length > 0) {
      console.log("Org admin user already exists with that username or email.");
      process.exit(0);
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await client.query(
      `INSERT INTO organization_users
         (organization_id, username, email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, $5, $6, 'org_admin')
       RETURNING id`,
      [
        org.id,
        username.toLowerCase().trim(),
        email.toLowerCase().trim(),
        passwordHash,
        firstName.trim(),
        lastName.trim(),
      ]
    );

    console.log(`\n✓ Org admin created successfully!`);
    console.log(`  Organization : ${org.name}`);
    console.log(`  Username     : ${username}`);
    console.log(`  Password     : ${password}`);
    console.log(`  Email        : ${email}`);
    console.log(`  ID           : ${result.rows[0].id}`);
    console.log(`\nLogin at: https://mymd.health-assist.org/org/login`);
  } finally {
    client.release();
    await pool.end();
  }
}

createOrgAdmin()
  .then(() => process.exit(0))
  .catch(err => { console.error("Failed:", err.message); process.exit(1); });
