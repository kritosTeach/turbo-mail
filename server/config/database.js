const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL error', { error: err.message });
});

pool.on('connect', () => {
  logger.debug('New PostgreSQL connection established');
});

async function runMigrations() {
  const sqlPath = path.join(__dirname, '..', '..', 'migrations', 'init.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = await pool.connect();
  try {
    logger.info('Running database migrations...');
    await client.query(sql);
    logger.info('Database migrations completed successfully');
  } catch (err) {
    logger.error('Database migration failed', { error: err.message });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Ensures the admin user exists with a valid bcryptjs password hash.
 *
 * This runs after the SQL migrations so the users table is guaranteed to
 * exist. It upserts the admin row and always overwrites the password_hash
 * with a freshly generated bcryptjs hash (salt rounds 12), matching the
 * same library and configuration used by bcrypt.compare() in passport.js
 * and bcrypt.hash() in routes/auth.js.
 */
async function initializeAdmin() {
  const ADMIN_USERNAME = 'admin';
  const ADMIN_EMAIL    = 'admin@turbomailer.local';
  const ADMIN_PASSWORD = 'admin123';
  const SALT_ROUNDS    = 12;

  const client = await pool.connect();
  try {
    logger.info('Initializing admin user with bcryptjs password hash...');

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);

    await client.query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (username)
       DO UPDATE SET password_hash = EXCLUDED.password_hash,
                     updated_at    = NOW()`,
      [ADMIN_USERNAME, ADMIN_EMAIL, passwordHash]
    );

    logger.info('Admin user initialized successfully (username: admin)');
  } catch (err) {
    logger.error('Failed to initialize admin user', { error: err.message });
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  pool,
  runMigrations,
  initializeAdmin
};