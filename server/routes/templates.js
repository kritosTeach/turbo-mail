const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');

// List templates
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const { category, search } = req.query;
    let query = 'SELECT id, name, subject, category, is_default, created_by, created_at, updated_at FROM templates';
    let params = [];
    const conditions = [];

    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(name ILIKE $${params.length} OR subject ILIKE $${params.length})`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY updated_at DESC';

    const result = await db.query(query, params);
    res.json({ templates: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single template
router.get('/:id', isAuthenticated, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM templates WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }
    res.json({ template: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create template
router.post('/', isAuthenticated, async (req, res) => {
  try {
    const { name, subject, html_content, plain_text, variables, category } = req.body;

    const result = await db.query(
      `INSERT INTO templates (name, subject, html_content, plain_text, variables, category, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, subject, category, variables, is_default, created_at`,
      [name, subject, html_content, plain_text || null,
       JSON.stringify(variables || []), category || null, req.user.id]
    );

    await auditLog(req, 'create_template', 'template', result.rows[0].id, { name });

    res.status(201).json({ template: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update template
router.put('/:id', isAuthenticated, async (req, res) => {
  try {
    const { name, subject, html_content, plain_text, variables, category } = req.body;

    const result = await db.query(
      `UPDATE templates SET
        name = COALESCE($1, name),
        subject = COALESCE($2, subject),
        html_content = COALESCE($3, html_content),
        plain_text = COALESCE($4, plain_text),
        variables = COALESCE($5, variables),
        category = COALESCE($6, category),
        updated_at = NOW()
       WHERE id = $7
       RETURNING id, name, subject, category, variables, is_default, updated_at`,
      [name, subject, html_content, plain_text,
       variables ? JSON.stringify(variables) : null, category, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    await auditLog(req, 'update_template', 'template', req.params.id);

    res.json({ template: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete template
router.delete('/:id', isAuthenticated, async (req, res) => {
  try {
    await db.query('DELETE FROM templates WHERE id = $1', [req.params.id]);
    await auditLog(req, 'delete_template', 'template', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set as default
router.post('/:id/default', isAuthenticated, async (req, res) => {
  try {
    await db.query('UPDATE templates SET is_default = false WHERE is_default = true');
    await db.query('UPDATE templates SET is_default = true WHERE id = $1', [req.params.id]);
    await auditLog(req, 'set_default_template', 'template', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;