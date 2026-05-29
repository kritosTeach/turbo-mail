const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');

// Get logs with filtering
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const {
      campaign_id, status, recipient_email, date_from, date_to,
      page = 1, limit = 50, sort_by = 'created_at', sort_order = 'DESC'
    } = req.query;

    let query = 'SELECT * FROM email_logs WHERE 1=1';
    let params = [];
    let paramIdx = 1;
    const allowedSortFields = ['created_at', 'sent_at', 'recipient_email', 'status', 'subject'];

    const sortField = allowedSortFields.includes(sort_by) ? sort_by : 'created_at';
    const order = sort_order === 'ASC' ? 'ASC' : 'DESC';

    if (campaign_id) {
      query += ` AND campaign_id = $${paramIdx++}`;
      params.push(campaign_id);
    }
    if (status) {
      if (Array.isArray(status)) {
        query += ` AND status = ANY($${paramIdx++})`;
        params.push(status);
      } else {
        query += ` AND status = $${paramIdx++}`;
        params.push(status);
      }
    }
    if (recipient_email) {
      query += ` AND recipient_email ILIKE $${paramIdx++}`;
      params.push(`%${recipient_email}%`);
    }
    if (date_from) {
      query += ` AND created_at >= $${paramIdx++}`;
      params.push(date_from);
    }
    if (date_to) {
      query += ` AND created_at <= $${paramIdx++}`;
      params.push(date_to);
    }

    // Get total count
    const countResult = await db.query(
      query.replace('SELECT *', 'SELECT COUNT(*)'),
      params
    );
    const total = parseInt(countResult.rows[0].count);

    query += ` ORDER BY ${sortField} ${order}`;
    query += ` LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(limit, (page - 1) * limit);

    const result = await db.query(query, params);

    res.json({
      logs: result.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single log
router.get('/:id', isAuthenticated, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM email_logs WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Log not found' });
    }
    res.json({ log: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export logs as CSV
router.get('/export/csv', isAuthenticated, async (req, res) => {
  try {
    const { campaign_id, status, date_from, date_to } = req.query;
    let query = 'SELECT * FROM email_logs WHERE 1=1';
    let params = [];
    let paramIdx = 1;

    if (campaign_id) {
      query += ` AND campaign_id = $${paramIdx++}`;
      params.push(campaign_id);
    }
    if (status) {
      query += ` AND status = $${paramIdx++}`;
      params.push(status);
    }
    if (date_from) {
      query += ` AND created_at >= $${paramIdx++}`;
      params.push(date_from);
    }
    if (date_to) {
      query += ` AND created_at <= $${paramIdx++}`;
      params.push(date_to);
    }

    query += ' ORDER BY created_at DESC';

    const result = await db.query(query, params);

    // Build CSV
    const headers = ['ID', 'Campaign ID', 'Recipient Email', 'Subject', 'From Email',
      'SMTP Server', 'Status', 'Error Message', 'Response Code', 'Message ID',
      'Sent At', 'Created At'];
    const rows = result.rows.map(r => [
      r.id, r.campaign_id, r.recipient_email, `"${(r.subject || '').replace(/"/g, '""')}"`,
      r.from_email, r.smtp_server_name, r.status,
      `"${(r.error_message || '').replace(/"/g, '""')}"`,
      r.response_code, r.message_id, r.sent_at, r.created_at
    ]);

    let csv = headers.join(',') + '\n';
    csv += rows.map(row => row.join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=email_logs.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export logs as JSON
router.get('/export/json', isAuthenticated, async (req, res) => {
  try {
    const { campaign_id, status, date_from, date_to } = req.query;
    let query = 'SELECT * FROM email_logs WHERE 1=1';
    let params = [];
    let paramIdx = 1;

    if (campaign_id) {
      query += ` AND campaign_id = $${paramIdx++}`;
      params.push(campaign_id);
    }
    if (status) {
      query += ` AND status = $${paramIdx++}`;
      params.push(status);
    }
    if (date_from) {
      query += ` AND created_at >= $${paramIdx++}`;
      params.push(date_from);
    }
    if (date_to) {
      query += ` AND created_at <= $${paramIdx++}`;
      params.push(date_to);
    }

    query += ' ORDER BY created_at DESC';

    const result = await db.query(query, params);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=email_logs.json');
    res.json({ logs: result.rows, exported_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;