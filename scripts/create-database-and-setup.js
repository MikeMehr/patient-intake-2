/**
 * Complete database setup script
 * Creates the database if it doesn't exist, then runs all migrations
 */

const { Pool, Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Load .env.local if it exists (with error handling for protected files)
try {
  require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
} catch (e) {
  // dotenv not available or file is protected, try manual parsing
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
  } catch (readError) {
    // File exists but can't be read (permissions), that's okay
    console.log('Note: Could not read .env.local (may be protected), using environment variables or defaults');
  }
}

// Get database name from DATABASE_URL or use default
let databaseUrl = process.env.DATABASE_URL;
let databaseName = 'patient_intake';
let baseUrl = 'postgresql://localhost:5432';

// Parse DATABASE_URL if it exists
if (databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    databaseName = url.pathname.slice(1) || 'patient_intake';
    baseUrl = `${url.protocol}//${url.username ? url.username + (url.password ? ':' + url.password : '') + '@' : ''}${url.hostname}:${url.port || 5432}`;
  } catch (e) {
    console.log('Could not parse DATABASE_URL, using defaults');
  }
} else {
  // Try to get username from system
  const username = require('os').userInfo().username;
  databaseUrl = `postgresql://${username}@localhost:5432/postgres`;
  console.log(`No DATABASE_URL found, will use: postgresql://${username}@localhost:5432/${databaseName}`);
}

async function createDatabase() {
  // Connect to default postgres database to create our database
  const adminClient = new Client({
    connectionString: databaseUrl.includes('/postgres') ? databaseUrl : `${baseUrl}/postgres`,
  });

  try {
    await adminClient.connect();
    console.log('Connected to PostgreSQL server');

    // Check if database exists
    const result = await adminClient.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [databaseName]
    );

    if (result.rows.length > 0) {
      console.log(`Database '${databaseName}' already exists`);
    } else {
      // Create database
      await adminClient.query(`CREATE DATABASE ${databaseName}`);
      console.log(`✓ Database '${databaseName}' created successfully`);
    }
  } catch (error) {
    if (error.code === '42P04') {
      console.log(`Database '${databaseName}' already exists`);
    } else {
      console.error('Error creating database:', error.message);
      throw error;
    }
  } finally {
    await adminClient.end();
  }
}

async function runAllMigrations() {
  const finalUrl = databaseUrl.includes(`/${databaseName}`) 
    ? databaseUrl 
    : `${baseUrl}/${databaseName}`;

  const pool = new Pool({
    connectionString: finalUrl,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();
  try {
    const migrationsDir = path.join(__dirname, '../src/lib/migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // Run in order: 000, 001, 002, etc.

    console.log(`\nFound ${files.length} migration files\n`);

    for (const file of files) {
      console.log(`Running migration: ${file}...`);
      const migrationPath = path.join(migrationsDir, file);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
      
      try {
        await client.query(migrationSQL);
        console.log(`✓ ${file} completed\n`);
      } catch (error) {
        if (error.code === '42P07' || error.message.includes('already exists') || error.message.includes('duplicate')) {
          console.log(`⚠ ${file} - Some objects already exist, continuing...\n`);
        } else {
          console.error(`Error in ${file}:`, error.message);
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

async function main() {
  try {
    console.log('Starting database setup...\n');
    
    // Step 1: Create database
    await createDatabase();
    
    // Step 2: Run migrations
    await runAllMigrations();
    
    console.log('\n✓ Database setup complete!');
    console.log(`\nNext steps:`);
    console.log(`1. Make sure DATABASE_URL is set in .env.local:`);
    console.log(`   DATABASE_URL=postgresql://${require('os').userInfo().username}@localhost:5432/${databaseName}`);
    console.log(`2. Create a super admin user:`);
    console.log(`   node scripts/create-super-admin.js`);
    
  } catch (error) {
    console.error('\n✗ Setup failed:', error.message);
    console.error('\nTroubleshooting:');
    console.error('1. Make sure PostgreSQL is running: brew services start postgresql');
    console.error('2. Make sure you can connect: psql postgres');
    console.error('3. Check your DATABASE_URL in .env.local');
    process.exit(1);
  }
}

main();

