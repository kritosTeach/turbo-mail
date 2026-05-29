const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
const EmailValidator = require('../services/validator');
const ImporterService = require('../services/importer');

const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.csv' || ext === '.txt') {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and TXT files are allowed'));
    }
  }
});

// Import CSV/TXT
router.post('/import', isAuthenticated, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    let rawRecipients;

    if (ext === '.csv') {
      rawRecipients = ImporterService.parseCSV(req.file.path);
    } else {
      rawRecipients = ImporterService.parseTXT(req.file.path);
    }

    // Validate emails
    const validation = EmailValidator.validateBatch(rawRecipients.map(r => r.email));
    const validRecipients = rawRecipients.filter(r =>
      validation.valid.includes(r.email.toLowerCase().trim())
    );

    // Check blacklist
    const blacklistResult = await db.query('SELECT value FROM blacklist WHERE type = $1', ['email']);
    const blacklistedEmails = new Set(blacklistResult.rows.map(r => r.value));

    const domainResult = await db.query('SELECT value FROM blacklist WHERE type = $1', ['domain']);
    const blacklistedDomains = domainResult.rows.map(r => r.value);

    const filtered = validRecipients.filter(r => {
      const email = r.email.toLowerCase().trim();
      const domain = email.split('@')[1];
      if (blacklistedEmails.has(email)) return false;
      if (blacklistedDomains.some(d => domain === d || domain.endsWith('.' + d))) return false;
      return true;
    });

    // Clean up temp file
    fs.unlinkSync(req.file.path);

    await auditLog(req, 'import_recipients', 'file', null, {
      filename: req.file.originalname,
      total: rawRecipients.length,
      valid: filtered.length,
      invalid: validation.invalid.length
    });

    res.json({
      total: rawRecipients.length,
      valid: filtered.length,
      invalid: validation.invalid.length,
      blacklisted: rawRecipients.length - validRecipients.length,
      recipients: filtered
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: err.message });
  }
});

// Add manual recipients
router.post('/manual', isAuthenticated, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'No recipients provided' });
    }

    const rawRecipients = ImporterService.parseManualInput(textapse);
    const validation = EmailValidator.validateBatch(rawRecipients.map(r => r.email));

    // Check blacklist
    const blacklistResult = await db.query('SELECT value FROM blacklist');
    const blacklisted = new Map();
    blacklistResult.rows.forEach(r => {
      if (r.type === 'email') blacklisted.set(r.value, true);
      if (r.type === 'domain') blacklisted.set(r.value, 'domain');
    });

    const filtered = rawRecipients.filter(r => {
      const email = r.email.toLowerCase().trim();
      const domain = email.split('@')[1];
      if (blacklisted.has(email)) return false;
      if (blacklisted.has(domain) || [...blacklisted.keys()].some(k =>
        blacklisted.get(k) === 'domain' && (domain === k || domain.endsWith('.' + k))
      )) return false;
      return true;
    });

    res.json({
      total: rawRecipients.length,
      valid: filtered.length,
      invalid: validation.invalid.length,
      blacklisted: rawRecipients.length - validation.valid.length - validation.invalid.length,
      recipients: filtered
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List blacklist
router.get('/blacklist', isAuthenticated, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, value, type, reason, created_at FROM blacklist ORDER BY created_at DESC'
    );
    res.json({ blacklist: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add to blacklist
router.post('/blacklist', isAuthenticated, async (req, res) => {
  try {
    const { value, type, reason } = req.body;
    if (!value || !type) {
      return res.status(400).json({ error: 'Value and type are required' });
    }

    await db.query(
      `INSERT INTO blacklist (value, type, reason, created_by)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [value.toLowerCase(), type, reason || null, req.user.id]
    );

    await auditLog(req, 'add_blacklist', 'blacklist', null, { value, type });

    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove from blacklist
router.delete('/blacklist/:id', isAuthenticated, async (req, res) => {
  try {
    await db.query('DELETE FROM blacklist WHERE id = $1', [req.params.id]);
    await auditLog(req, 'remove_blacklist', 'blacklist', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Validate email
router.post('/validate', isAuthenticated, async (req, res) => {
  try {
    const { emails, check_mx } = req.body;
    if (!emails || !Array.isArray(emails)) {
      return res.status(400).json({ error: 'emails array is required' });
    }

    if (check_mx) {
      const results = await Promise.all(
        emails.map(e => EmailValidator.validateEmailWithMX(e))
      );
      return res.json({ results });
    }

    const results = emails.map(e => EmailValidator.validateEmail(e));
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;