#!/usr/bin/env node
/**
 * init-admin.js
 *
 * Drops and recreates the users table, then inserts the admin user with a
 * bcryptjs-generated password hash so that bcrypt.compare() in
 * server/config/passport.js works correctly at login time.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/init-admin.js
 */

require('dotenv').config();

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const ADMIN_USERNAME = 'admin';
const ADMIN_EMAIL    = 'admin@turbomailer.local';
const ADMIN_PASSWORD = 'admin123';
const SALT_ROUNDS    = 12; // must match bcrypt.hash(password, 12) in server/routes/auth.js

async function initAdmin() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
  });

  const client = await pool.connect();

  try {
    console.log('[init-admin] Hashing admin password with bcryptjs (salt rounds: %d)...', SALT_ROUNDS);
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);
    console.log('[init-admin] Password hash generated successfully.');

    // Ensure the uuid-ossp extension exists (needed for uuid_generate_v4())
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    // Drop and recreate the users table so any stale/invalid hash is removed
    console.log('[init-admin] Dropping users table (if it exists)...');
    await client.query('DROP TABLE IF EXISTS users CASCADE');

    console.log('[init-admin] Recreating users table...');
    await client.query(`
      CREATE TABLE users (
        id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        username           VARCHAR(100) UNIQUE NOT NULL,
        email              VARCHAR(255) UNIQUE NOT NULL,
        password_hash      VARCHAR(255) NOT NULL,
        role               VARCHAR(20)  NOT NULL DEFAULT 'operator'
                             CHECK (role IN ('admin', 'operator', 'viewer')),
        two_factor_enabled BOOLEAN      DEFAULT FALSE,
        two_factor_secret  VARCHAR(100),
        api_key            VARCHAR(64)  UNIQUE,
        is_active          BOOLEAN      DEFAULT TRUE,
        created_at         TIMESTAMPTZ  DEFAULT NOW(),
        updated_at         TIMESTAMPTZ  DEFAULT NOW()
      )
    `);

    console.log('[init-admin] Inserting admin user...');
    await client.query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ($1, $2, $3, 'admin')`,
      [ADMIN_USERNAME, ADMIN_EMAIL, passwordHash]
    );

    console.log('[init-admin] Admin user created successfully.');
    console.log('[init-admin]   username : %s', ADMIN_USERNAME);
    console.log('[init-admin]   email    : %s', ADMIN_EMAIL);
    console.log('[init-admin]   password : %s (hashed)', ADMIN_PASSWORD);
  } catch (err) {
    console.error('[init-admin] ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

initAdmin();
