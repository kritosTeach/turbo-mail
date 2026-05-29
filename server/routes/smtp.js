const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { encrypt, decrypt } = require('../utils/encryption');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
const mailer = require('../services/mailer');
// Bulk import SMTPs
router.post('/bulk', isAuthenticated, async (req, res) => {
  const { smtps } = req.body;
  if (!Array.isArray(smtps) || smtps.length === 0) {
    return res.status(400).json({ error: 'Invalid data format' });
  }

  let succeeded = 0;
  const failures = [];

  for (const smtp of smtps) {
    // Validate required fields
    if (!smtp.host || !smtp.port || !smtp.username || !smtp.password) {
      failures.push({ entry: smtp.host || '(unknown)', reason: 'Missing required fields' });
      continue;
    }

    const port = parseInt(smtp.port, 10);
    if (isNaN(port)) {
      failures.push({ entry: smtp.host, reason: 'Invalid port number' });
      continue;
    }

    let encryptedPassword;
    try {
      encryptedPassword = encrypt(smtp.password);
    } catch (encErr) {
      failures.push({ entry: smtp.host, reason: `Encryption error: ${encErr.message}` });
      continue;
    }

    const client = await db.getClient();
    try {
      await client.query(
        `INSERT INTO smtp_servers (name, host, port, encryption, username, password_encrypted, auth_method, priority, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [smtp.name || smtp.host, smtp.host, port, smtp.encryption || 'tls',
         smtp.username, encryptedPassword, 'login', smtp.priority || 0, req.user.id]
      );
      succeeded++;
    } catch (dbErr) {
      failures.push({ entry: smtp.host, reason: dbErr.message });
    } finally {
      client.release();
    }
  }

  await auditLog(req, 'bulk_import_smtp', 'smtp_server', null, { succeeded, failed: failures.length });

  res.json({ success: true, count: succeeded, failed: failures.length, failures });
});
// List all SMTP servers
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, host, port, encryption, username, auth_method, max_connections,
              is_active, priority, fail_count, last_used_at, created_at
       FROM smtp_servers ORDER BY priority ASC, name ASC`
    );
    res.json({ smtp_servers: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single SMTP server
router.get('/:id', isAuthenticated, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, host, port, encryption, username, auth_method, max_connections,
              is_active, priority, fail_count, last_used_at, created_at
       FROM smtp_servers WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'SMTP server not found' });
    }
    res.json({ smtp_server: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add SMTP server
router.post('/', isAuthenticated, async (req, res) => {
  try {
    const { name, host, port, encryption, username, password, auth_method, max_connections, priority } = req.body;

    const encryptedPassword = auth_method !== 'none' && auth_method !== 'anonymous'
      ? encrypt(password)
      : null;

    const result = await db.query(
      `INSERT INTO smtp_servers (name, host, port, encryption, username, password_encrypted,
        auth_method, max_connections, priority, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, name, host, port, encryption, username, auth_method, max_connections, priority, created_at`,
      [name, host, port, encryption || 'tls', username || null, encryptedPassword,
       auth_method || 'login', max_connections || 5, priority || 0, req.user.id]
    );

    await auditLog(req, 'create_smtp', 'smtp_server', result.rows[0].id, { name, host });

    res.status(201).json({ smtp_server: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update SMTP server
router.put('/:id', isAuthenticated, async (req, res) => {
  try {
    const existing = await db.query('SELECT * FROM smtp_servers WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'SMTP server not found' });
    }

    const { name, host, port, encryption, username, password, auth_method, max_connections, priority, is_active } = req.body;

    let encryptedPassword = existing.rows[0].password_encrypted;
    if (password) {
      encryptedPassword = encrypt(password);
    }

    const result = await db.query(
      `UPDATE smtp_servers SET
        name = COALESCE($1, name),
        host = COALESCE($2, host),
        port = COALESCE($3, port),
        encryption = COALESCE($4, encryption),
        username = COALESCE($5, username),
        password_encrypted = COALESCE($6, password_encrypted),
        auth_method = COALESCE($7, auth_method),
        max_connections = COALESCE($8, max_connections),
        priority = COALESCE($9, priority),
        is_active = COALESCE($10, is_active),
        updated_at = NOW()
       WHERE id = $11
       RETURNING id, name, host, port, encryption, username, auth_method, max_connections, priority, is_active, updated_at`,
      [name, host, port, encryption, username, encryptedPassword, auth_method,
       max_connections, priority, is_active, req.params.id]
    );

    // Clear cached transporter
    mailer.clearTransporter(req.params.id);

    await auditLog(req, 'update_smtp', 'smtp_server', req.params.id);

    res.json({ smtp_server: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete SMTP server
router.delete('/:id', isAuthenticated, async (req, res) => {
  try {
    await db.query('DELETE FROM smtp_servers WHERE id = $1', [req.params.id]);
    mailer.clearTransporter(req.params.id);

    await auditLog(req, 'delete_smtp', 'smtp_server', req.params.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test SMTP connection
router.post('/:id/test', isAuthenticated, async (req, res) => {
  try {
    const result = await mailer.testConnection(req.params.idapsed);

    await auditLog(req, 'test_smtp', 'smtp_server', req.params.id, { success: result.success });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;