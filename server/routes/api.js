const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');
const { emailQueue } = require('../queue/emailQueue');
const ImporterService = require('../services/importer');

// Send email via API
router.post('/send', isAuthenticated, async (req, res) => {
  try {
    const { to, subject, html, from_name, from_email, smtp_server_id } = req.body;

    if (!to || !subject || !html) {
      return res.status(400).json({ error: 'to, subject, and html are required' });
    }

    // Create a quick campaign for this single email
    const campaignResult = await db.query(
      `INSERT INTO campaigns (name, subject, from_name, from_email, html_content,
        smtp_server_id, total_recipients, created_by, tracking_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [`API: ${subject.slice(0, 50)}`, subject, from_name || '', from_email || req.user.email,
       html, smtp_server_id || null, 1, req.user.id, false]
    );

    const campaignId = campaignResult.rows[0].id;

    // Add recipient
    const trackingToken = ImporterService.generateTrackingToken();
    await db.query(
      `INSERT INTO recipients (campaign_id, email, status, tracking_token)
       VALUES ($1, $2, $3, $4)`,
      [campaignId, to, 'queued', trackingToken]
    );

    // Queue the job
    await emailQueue.add('send-single', {
      recipientId: (await db.query(
        'SELECT id FROM recipients WHERE campaign_id = $1 LIMIT 1', [campaignId]
      )).rows[0].id,
      campaignId,
      smtpServerId: smtp_server_id
    });

    res.status(202).json({
      success: true,
      message: 'Email queued',
      campaignId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send bulk via API
router.post('/send/bulk', isAuthenticated, async (req, res) => {
  try {
    const { recipients, subject, html, from_name, from_email, smtp_server_id, throttle } = req.body;

    if (!recipients || !recipients.length || !subject || !html) {
      return res.status(400).json({ error: 'recipients array, subject, and html are required' });
    }

    const campaignResult = await db.query(
      `INSERT INTO campaigns (name, subject, from_name, from_email, html_content,
        smtp_server_id, total_recipients, throttle_rate, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [`API Bulk: ${subject.slice(0, 50)}`, subject, from_name || '', from_email || req.user.email,
       html, smtp_server_id || null, recipients.length, throttle || 30, req.user.id]
    );

    const campaignId = campaignResult.rows[0].id;

    // Add recipients
    const prepared = recipients.map(r => ({
      email: r.email,
      first_name: r.first_name || '',
      last_name: r.last_name || '',
      custom_fields: JSON.stringify(r.custom_fields || {}),
      tracking_token: ImporterService.generateTrackingToken()
    }));

    for (const r of prepared) {
      await db.query(
        `INSERT INTO recipients (campaign_id, email, first_name, last_name, custom_fields, status, tracking_token)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [campaignId, r.email, r.first_name, r.last_name, r.custom_fields, 'pending', r.tracking_token]
      );
    }

    // Queue all jobs
    const pendingRecipients = await db.query(
      "SELECT id FROM recipients WHERE campaign_id = $1 AND status = 'pending'",
      [campaignId]
    );

    const jobs = pendingRecipients.rows.map(r => ({
      name: `api-bulk-${r.id}`,
      data: { recipientId: r.id, campaignId, smtpServerId: smtp_server_id },
      opts: { attempts: 3 }
    }));

    await emailQueue.addBulk(jobs);

    res.status(202).json({
      success: true,
      message: `Bulk send queued: ${recipients.length} recipients`,
      campaignId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;