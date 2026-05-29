const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAuthenticated, requireRole } = require('../middleware/auth');

// Dashboard stats
router.get('/stats', isAuthenticated, async (req, res) => {
  try {
    // Overall stats
    const overallResult = await db.query(`
      SELECT
        COUNT(DISTINCT c.id) as total_campaigns,
        COALESCE(SUM(c.total_recipients), 0) as total_recipients,
        COALESCE(SUM(c.sent_count), 0) as total_sent,
        COALESCE(SUM(c.failed_count), 0) as total_failed,
        COALESCE(SUM(c.bounce_count), 0) as total_bounced,
        COALESCE(SUM(c.open_count), 0) as total_opens,
        COALESCE(SUM(c.click_count), 0) as total_clicks
      FROM campaigns c
      ${req.user.role === 'operator' ? `WHERE c.created_by = $1` : ''}
    `, req.user.role === 'operator' ? [req.user.id] : []);

    // Recent campaigns
    const recentResult = await db.query(`
      SELECT c.id, c.name, c.status, c.total_recipients, c.sent_count,
        c.failed_count, c.created_at, u.username as created_by_username
      FROM campaigns c
      LEFT JOIN users u ON c.created_by = u.id
      ${req.user.role === 'operator' ? 'WHERE c.created_by = $1' : ''}
      ORDER BY c.created_at DESC LIMIT 10
    `, req.user.role === 'operator' ? [req.user.id] : []);

    // Today's activity
    const todayResult = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) as today_sent,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as today_failed,
        COALESCE(SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END), 0) as today_bounced
      FROM email_logs
      WHERE created_at >= CURRENT_DATE
    `);

    // Delivery rate over time (last 7 days)
    const deliveryRateResult = await db.query(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) as bounced
      FROM email_logs
      WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY date
    `);

    // SMTP server health
    const smtpResult = await db.query(`
      SELECT id, name, host, port, is_active, fail_count, last_used_at
      FROM smtp_servers
      ORDER BY priority ASC
    `);

    // Top campaigns by delivery rate
    const topCampaignsResult = await db.query(`
      SELECT id, name, status, total_recipients, sent_count, failed_count,
        CASE WHEN total_recipients > 0
          THEN ROUND((sent_count::decimal / total_recipients) * 100, 2)
          ELSE 0
        END as delivery_rate
      FROM campaigns
      WHERE total_recipients > 0
      ORDER BY delivery_rate DESC
      LIMIT 10
    `);

    res.json({
      stats: overallResult.rows[0],
      today: todayResult.rows[0],
      recentCampaigns: recentResult.rows,
      deliveryRateOverTime: deliveryRateResult.rows,
      smtpServers: smtpResult.rows,
      topCampaigns: topCampaignsResult.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Real-time stream (used by SSE fallback)
router.get('/stream', isAuthenticated, async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-open',
    'X-Accel-Buffering': 'no'
  });

  const interval = setInterval(async () => {
    try {
      const result = await db.query(`
        SELECT
          COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '5 seconds' AND status = 'sent' THEN 1 ELSE 0 END), 0) as sent_last_5s,
          COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '5 seconds' AND status = 'failed' THEN 1 ELSE 0 END), 0) as failed_last_5s
        FROM email_logs
      `);
      res.write(`data: ${JSON.stringify(result.rows[0])}\n\n`);
    } catch (err) {
      // silent
    }
  }, 5000);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// Audit logs
router.get('/audit', isAuthenticated, requireRole('admin'), async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const result = await db.query(
      `SELECT al.*, u.username
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       ORDER BY al.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, (page - 1) * limit]
    );

    const countResult = await db.query('SELECT COUNT(*) FROM audit_logs');
    const total = parseInt(countResult.rows[0].count);

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

module.exports = router;