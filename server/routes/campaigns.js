const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
const { emailQueue } = require('../queue/emailQueue');
const ImporterService = require('../services/importer');

// List campaigns
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    let query = `
      SELECT c.*, u.username as created_by_username,
        (SELECT COUNT(*) FROM recipients WHERE campaign_id = c.id) as recipient_count
      FROM campaigns c
      LEFT JOIN users u ON c.created_by = u.id
    `;
    let params = [];
    const conditions = [];

    if (status) {
      params.push(status);
      conditions.push(`c.status = $${params.length}`);
    }

    if (req.user.role === 'operator') {
      params.push(req.user.id);
      conditions.push(`c.created_by = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY c.created_at DESC';
    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, (page - 1) * limit);

    const result = await db.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM campaigns c';
    if (conditions.length > 0) {
      countQuery += ' WHERE ' + conditions.join(' AND ');
    }
    const countResult = await db.query(countQuery, params.slice(0, -2));
    const total = parseInt(countResult.rows[0].count);

    res.json({
      campaigns: result.rows,
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

// Get single campaign
router.get('/:id', isAuthenticated, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, u.username as created_by_username,
        (SELECT COUNT(*) FROM recipients WHERE campaign_id = c.id) as recipient_count,
        (SELECT COUNT(*) FROM recipients WHERE campaign_id = c.id AND status = 'sent') as sent_count,
        (SELECT COUNT(*) FROM recipients WHERE campaign_id = c.id AND status = 'failed') as failed_count,
        (SELECT COUNT(*) FROM recipients WHERE campaign_id = c.id AND status = 'bounced') as bounce_count,
        (SELECT COUNT(*) FROM recipients WHERE campaign_id = c.id AND status = 'opened') as open_count,
        (SELECT COUNT(*) FROM recipients WHERE campaign_id = c.id AND status = 'clicked') as click_count
       FROM campaigns c
       LEFT JOIN users u ON c.created_by = u.id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    res.json({ campaign: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create campaign
router.post('/', isAuthenticated, async (req, res) => {
  try {
    const {
      name, subject, from_name, from_email, reply_to, return_path,
      html_content, plain_text, smtp_server_id, template_id,
      schedule_at, throttle_rate, tracking_enabled, recipients
    } = req.body;

    const result = await db.query(
      `INSERT INTO campaigns (name, subject, from_name, from_email, reply_to, return_path,
        html_content, plain_text, smtp_server_id, template_id,
        schedule_at, throttle_rate, tracking_enabled, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id, name, subject, status, created_at`,
      [name, subject, from_name || '', from_email, reply_to || null, return_path || null,
       html_content, plain_text || null, smtp_server_id || null, template_id || null,
       schedule_at || null, throttle_rate || 30, tracking_enabled !== false, req.user.id]
    );

    const campaignId = result.rows[0].id;

    // Add recipients if provided
    if (recipients && recipients.length > 0) {
      const preparedRecipients = ImporterService.prepareRecipients(recipients, campaignId);

      for (const r of preparedRecipients) {
        await db.query(
          `INSERT INTO recipients (campaign_id, email, first_name, last_name, custom_fields, status, tracking_token)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [r.campaign_id, r.email, r.first_name, r.last_name, r.custom_fields, r.status, r.tracking_token]
        );
      }

      await db.query(
        'UPDATE campaigns SET total_recipients = $1 WHERE id = $2',
        [preparedRecipients.length, campaignId]
      );
    }

    await auditLog(req, 'create_campaign', 'campaign', campaignId, { name });

    res.status(201).json({ campaign: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update campaign
router.put('/:id', isAuthenticated, async (req, res) => {
  try {
    const fields = [];
    const params = [];
    let paramIndex = 1;

    const updateableFields = [
      'name', 'subject', 'from_name', 'from_email', 'reply_to', 'return_path',
      'html_content', 'plain_text', 'smtp_server_id', 'template_id',
      'schedule_at', 'throttle_rate', 'tracking_enabled'
    ];

    for (const field of updateableFields) {
      if (req.body[field] !== undefined) {
        fields.push(`${field} = $${paramIndex++}`);
        params.push(req.body[field]);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    fields.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await db.query(
      `UPDATE campaigns SET ${fields.join(', ')} WHERE id = $${paramIndex}
       RETURNING id, name, subject, status, updated_at`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    await auditLog(req, 'update_campaign', 'campaign', req.params.id);

    res.json({ campaign: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete campaign
router.delete('/:id', isAuthenticated, async (req, res) => {
  try {
    await db.query('DELETE FROM campaigns WHERE id = $1', [req.params.id]);
    await auditLog(req, 'delete_campaign', 'campaign', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start campaign
router.post('/:id/start', isAuthenticated, async (req, res) => {
  try {
    const campaignResult = await db.query(
      `SELECT * FROM campaigns WHERE id = $1 AND status IN ('draft', 'paused')`,
      [req.params.id]
    );

    if (campaignResult.rows.length === 0) {
      return res.status(400).json({ error: 'Campaign not found or cannot be started' });
    }

    const campaign = campaignResult.rows[0];

    // Get pending recipients
    const recipientsResult = await db.query(
      'SELECT id, email, first_name, last_name FROM recipients WHERE campaign_id = $1 AND status = $2',
      [req.params.id, 'pending']
    );

    if (recipientsResult.rows.length === 0) {
      return res.status(400).json({ error: 'No pending recipients to send to' });
    }

    // Update campaign status
    await db.query(
      "UPDATE campaigns SET status = 'sending', updated_at = NOW() WHERE id = $1",
      [req.params.id]
    );

    // Queue all recipients
    const jobs = recipientsResult.rows.map(r => ({
      name: `send-${r.id}`,
      data: {
        recipientId: r.id,
        campaignId: campaign.id,
        smtpServerId: campaign.smtp_server_id
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 }
      }
    }));

    // Add jobs in batches
    const batchSize = 100;
    for (let i = 0; i < jobs.length; i += batchSize) {
      const batch = jobs.slice(i, i + batchSize);
      await emailQueue.addBulk(batch);
    }

    // Update recipient status to queued
    await db.query(
      'UPDATE recipients SET status = $1 WHERE campaign_id = $2 AND status = $3',
      ['queued', req.params.id, 'pending']
    );

    await auditLog(req, 'start_campaign', 'campaign', req.params.id, {
      totalRecipients: recipientsResult.rows.length
    });

    res.json({
      success: true,
      message: `Campaign started with ${recipientsResult.rows.length} recipients`,
      totalQueued: recipientsResult.rows.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pause campaign
router.post('/:id/pause', isAuthenticated, async (req, res) => {
  try {
    await db.query(
      "UPDATE campaigns SET status = 'paused', updated_at = NOW() WHERE id = $1 AND status = 'sending'",
      [req.params.id]
    );

    // Pause jobs in queue
    const jobs = await emailQueue.getJobs(['active', 'waiting']);
    const campaignJobs = jobs.filter(j => j.data.campaignId === req.params.id);
    for (const job of campaignJobs) {
      await job.discard();
    }

    await auditLog(req, 'pause_campaign', 'campaign', req.params.id);

    res.json({ success: true, message: 'Campaign paused' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resume campaign
router.post('/:id/resume', isAuthenticated, async (req, res) => {
  try {
    // Re-queue pending failed recipients
    const failedResult = await db.query(
      "SELECT id FROM recipients WHERE campaign_id = $1 AND status = 'failed' AND retry_count < 3",
      [req.params.id]
    );

    // Also re-queue pending ones
    const result = await db.query(
      'SELECT id FROM recipients WHERE campaign_id = $1 AND status IN ($2, $3)',
      [req.params.id, 'failed', 'pending']
    );

    const jobs = result.rows.map(r => ({
      name: `send-${r.id}`,
      data: {
        recipientId: r.id,
        campaignId: req.params.id
      },
      opts: { attempts: 3 }
    }));

    if (jobs.length > 0) {
      await emailQueue.addBulk(jobs);
    }

    await db.query(
      "UPDATE campaigns SET status = 'sending', updated_at = NOW() WHERE id = $1",
      [req.params.id]
    );

    await auditLog(req, 'resume_campaign', 'campaign', req.params.id, {
      requeued: jobs.length
    });

    res.json({ success: true, message: `Resumed with ${jobs.length} remaining` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel campaign
router.post('/:id/cancel', isAuthenticated, async (req, res) => {
  try {
    // Remove all pending jobs for this campaign
    const jobs = await emailQueue.getJobs(['waiting', 'active', 'delayed']);
    const campaignJobs = jobs.filter(j => j.data.campaignId === req.params.id);
    for (const job of campaignJobs) {
      await job.remove();
    }

    await db.query(
      "UPDATE campaigns SET status = 'cancelled', updated_at = NOW() WHERE id = $1",
      [req.params.id]
    );

    await db.query(
      "UPDATE recipients SET status = 'pending' WHERE campaign_id = $1 AND status = 'queued'",
      [req.params.id]
    );

    await auditLog(req, 'cancel_campaign', 'campaign', req.params.id);

    res.json({ success: true, message: 'Campaign cancelled' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get campaign recipients
router.get('/:id/recipients', isAuthenticated, async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    let query = 'SELECT * FROM recipients WHERE campaign_id = $1';
    let params = [req.params.id];
    let paramIdx = 2;

    if (status) {
      query += ` AND status = $${paramIdx++}`;
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';
    query += ` LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(limit, (page - 1) * limit);

    const result = await db.query(query, params);

    res.json({
      recipients: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;