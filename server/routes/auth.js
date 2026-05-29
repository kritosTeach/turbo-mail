const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const passport = require('../config/passport');
const db = require('../config/database');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
const rateLimiter = require('../middleware/rateLimiter');

// Login
router.post('/login', rateLimiter, (req, res, next) => {
  passport.authenticate('local', async (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ error: info.message });

    req.login(user, async (err) => {
      if (err) return next(err);

      await auditLog(req, 'login', 'user', user.id);

      // Generate JWT as well
      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        process.env.JWT_SECRET || 'jwt-secret',
        { expiresIn: process.env.JWT_EXPIRY || '7d' }
      );

      res.json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          two_factor_enabled: user.two_factor_enabled
        },
        token,
        requires2FA: user.two_factor_enabled
      });
    });
  })(req, res, next);
});

// Logout
router.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.json({ success: true });
  });
});

// Get current user
router.get('/me', isAuthenticated, (req, res) => {
  res.json({ user: req.user });
});

// Setup 2FA
router.post('/2fa/setup', isAuthenticated, async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({
      name: `TurboMailer:${req.user.username}`
    });

    const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

    // Store temporarily
    req.session.two_factor_temp_secret = secret.base32;

    res.json({
      secret: secret.base32,
      qrCode: qrCodeUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify and enable 2FA
router.post('/2fa/verify', isAuthenticated, async (req, res) => {
  try {
    const { token } = req.body;
    const secret = req.session.two_factor_temp_secret;

    if (!secret) {
      return res.status(400).json({ error: '2FA setup not initiated' });
    }

    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: token,
      window: 2
    });

    if (!verified) {
      return res.status(400).json({ error: 'Invalid token' });
    }

    await db.query(
      'UPDATE users SET two_factor_enabled = true, two_factor_secret = $1 WHERE id = $2',
      [secret, req.user.id]
    );

    delete req.session.two_factor_temp_secret;

    await auditLog(req, 'enable_2fa', 'user', req.user.id);

    res.json({ success: true, message: '2FA enabled successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify 2FA during login
router.post('/2fa/authenticate', async (req, res) => {
  try {
    const { userId, token } = req.body;

    const result = await db.query(
      'SELECT id, username, two_factor_secret FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: 'base32',
      token: token,
      window: 2
    });

    if (!verified) {
      return res.status(401).json({ error: 'Invalid 2FA token' });
    }

    const jwtToken = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET || 'jwt-secret',
      { expiresIn: process.env.JWT_EXPIRY || '24h' }
    );

    res.json({ token: jwtToken, verified: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manage users (admin only)
router.get('/users', isAuthenticated, requireRole('admin'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, username, email, role, is_active, two_factor_enabled, created_at
       FROM users ORDER BY created_at DESC`
    );
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users', isAuthenticated, requireRole('admin'), async (req, res) => {
  try {
    const { username, email, password, role } = req.body;

    const existing = await db.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await db.query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING id, username, email, role, created_at`,
      [username, email, hash, role]
    );

    await auditLog(req, 'create_user', 'user', result.rows[0].id, { username, role });

    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/users/:id', isAuthenticated, requireRole('admin'), async (req, res) => {
  try {
    const { role, is_active } = req.body;
    const result = await db.query(
      `UPDATE users SET role = COALESCE($1, role), is_active = COALESCE($2, is_active),
       updated_at = NOW() WHERE id = $3 RETURNING id, username, email, role, is_active`,
      [role, is_active, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await auditLog(req, 'update_user', 'user', req.params.id, { role, is_active });

    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', isAuthenticated, requireRole('admin'), async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);

    await auditLog(req, 'delete_user', 'user', req.params.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate API key
router.post('/api-key', isAuthenticated, async (req, res) => {
  try {
    const apiKey = require('crypto').randomBytes(32).toString('hex');
    await db.query('UPDATE users SET api_key = $1 WHERE id = $2', [apiKey, req.user.id]);

    await auditLog(req, 'generate_api_key', 'user', req.user.id);

    res.json({ apiKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;