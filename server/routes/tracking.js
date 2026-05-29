const express = require('express');
const router = express.Router();
const db = require('../config/database');
const logger = require('../utils/logger');

// Open tracking pixel
router.get('/open/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { cid } = req.query;

    // Update recipient
    await db.query(
      `UPDATE recipients SET status = 'opened', opened_at = NOW()
       WHERE tracking_token = $1 AND (status = 'sent' OR status = 'opened')`,
      [token]
    );

    // Update campaign open count
    if (cid) {
      await db.query(
        'UPDATE campaigns SET open_count = open_count + 1 WHERE id = $1',
        [cid]
      );
    }

    // Create log entry
    await db.query(
      `INSERT INTO email_logs (campaign_id, recipient_id, recipient_email, subject, status,
        tracking_token, ip_address, user_agent)
       SELECT c.id, r.id, r.email, c.subject, 'opened', $1, $2, $3
       FROM recipients r
       JOIN campaigns c ON r.campaign_id = c.id
       WHERE r.tracking_token = $1
       LIMIT 1`,
      [token, req.ip, req.headers['user-agent'] || null]
    );

    // Return 1x1 transparent GIF
    const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/gif',
      'Content-Length': pixel.length,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(pixel);
  } catch (err) {
    logger.error('Tracking pixel error', { error: err.message });
    // Still return pixel
    const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.writeHead(200, { 'Content-Type': 'image/gif' });
    res.end(pixel);
  }
});

// Click tracking
router.get('/click/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { url, cid } = req.query;
    const targetUrl = url ? Buffer.from(url, 'base64').toString('utf-8') : '/';

    // Update recipient
    await db.query(
      `UPDATE recipients SET status = 'clicked', clicked_at = NOW()
       WHERE tracking_token = $1 AND (status = 'sent' OR status = 'opened' OR status = 'clicked')`,
      [token]
    );

    // Update campaign click count
    if (cid) {
      await db.query(
        'UPDATE campaigns SET click_count = click_count + 1 WHERE id = $1',
        [cid]
      );
    }

    // Create log entry
    await db.query(
      `INSERT INTO email_logs (campaign_id, recipient_id, recipient_email, subject, status,
        tracking_token, ip_address, user_agent)
       SELECT c.id, r.id, r.email, c.subject, 'clicked', $1, $2, $3
       FROM recipients r
       JOIN campaigns c ON r.campaign_id = c.id
       WHERE r.tracking_token = $1
       LIMIT 1`,
      [token, req.ip, req.headers['user-agent'] || null]
    );

    res.redirect(targetUrl);
  } catch (err) {
    logger.error('Click tracking error', { error: err.message });
    const targetUrl = req.query.url ? Buffer.from(req.query.url, 'base64').toString('utf-8') : '/';
    res.redirect(targetUrl);
  }
});

// Unsubscribe
router.get('/unsubscribe/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Mark as unsubscribed (using 'bounced' or you could add 'unsubscribed' status)
    await db.query(
      `UPDATE recipients SET status = 'bounced'
       WHERE tracking_token = $1`,
      [token]
    );

    // Add to blacklist
    const emailResult = await db.query(
      'SELECT email FROM recipients WHERE tracking_token = $1',
      [token]
    );

    if (emailResult.rows.length > 0) {
      await db.query(
        `INSERT INTO blacklist (value, type, reason)
         VALUES ($1, 'email', 'Unsubscribed via link')
         ON CONFLICT DO NOTHING`,
        [emailResult.rows[0].email]
      );
    }

    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Unsubscribed</title>
      <style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5}
      .card{background:white;padding:40px;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,0.1);text-align:center;max-width:400px}
      h1{color:#333;margin-bottom:16px}p{color:#666;line-height:1.6}
      </style></head>
      <body>
        <div class="card">
          <h1>Unsubscribed Successfully</h1>
          <p>You have been removed from this mailing list. You will no longer receive emails from this sender.</p>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    logger.error('Unsubscribe error', { error: err.message });
    res.status(500).send('Error processing unsubscribe');
  }
});

module.exports = router;