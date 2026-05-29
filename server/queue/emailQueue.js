const { Queue, Worker, QueueScheduler } = require('bullmq');
const db = require('../config/database');
const redis = require('../config/redis');
const mailer = require('../services/mailer');
const tracking = require('../services/tracking');
const logger = require('../utils/logger');

const emailQueue = new Queue('email-sending', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000
    },
    removeOnComplete: 100,
    removeOnFail: 50
  }
});

// Worker processes emails
const worker = new Worker('email-sending', async (job) => {
  const { recipientId, campaignId, smtpServerId } = job.data;
  const io = global.io || require('../index').io;

  try {
    // Get recipient data
    const recipientResult = await db.query(
      'SELECT * FROM recipients WHERE id = $1',
      [recipientId]
    );
    if (recipientResult.rows.length === 0) {
      throw new Error('Recipient not found');
    }
    const recipient = recipientResult.rows[0];

    // Get campaign data
    const campaignResult = await db.query('SELECT * FROM campaigns WHERE id = $1', [campaignId]);
    if (campaignResult.rows.length === 0) {
      throw new Error('Campaign not found');
    }
    const campaign = campaignResult.rows[0];

    // Get SMTP server (with fallback)
    let smtpId = smtpServerId || campaign.smtp_server_id;
    let smtpServer = null;

    if (smtpId) {
      const smtpResult = await db.query('SELECT * FROM smtp_servers WHERE id = $1', [smtpId]);
      if (smtpResult.rows.length > 0) {
        smtpServer = smtpResult.rows[0];
      }
    }

    // If SMTP server failed or not found, try fallback
    if (!smtpServer || smtpServer.fail_count > 5) {
      smtpServer = await mailer.findNextSmtp(smtpId);
      if (!smtpServer) {
        throw new Error('No available SMTP servers');
      }
    }

    // Prepare email content with variable replacement
    let htmlContent = campaign.html_content;
    let subject = campaign.subject;

    const variables = {
      '{{first_name}}': recipient.first_name || '',
      '{{last_name}}': recipient.last_name || '',
      '{{email}}': recipient.email,
      '{{unsubscribe_link}}': `${process.env.TRACKING_DOMAIN}/track/unsubscribe/${recipient.tracking_token}`,
      ...(recipient.custom_fields || {})
    };

    for (const [key, value] of Object.entries(variables)) {
      htmlContent = htmlContent.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
      subject = subject.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
    }

    // Inject tracking if enabled
    if (campaign.tracking_enabled) {
      htmlContent = tracking.injectTracking(htmlContent, recipient.tracking_token, campaignId);
    }

    const mailOptions = {
      from: `"${campaign.from_name || ''}" <${campaign.from_email}>`,
      to: recipient.email,
      subject: subject,
      html: htmlContent,
      replyTo: campaign.reply_to || campaign.from_email,
      envelope: {}
    };

    if (campaign.return_path) {
      mailOptions.envelope.from = campaign.return_path;
    }

    // Send the email
    const result = await mailer.sendEmail(smtpServer.id, mailOptions);

    // Update recipient status
    await db.query(
      `UPDATE recipients SET status = 'sent', sent_at = NOW(), error_message = NULL
       WHERE id = $1`,
      [recipientId]
    );

    // Update campaign counts
    await db.query(
      'UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = $1',
      [campaignId]
    );

    // Create log entry
    const logResult = await db.query(
      `INSERT INTO email_logs (campaign_id, recipient_id, recipient_email, subject, from_email,
        smtp_server_id, smtp_server_name, status, message_id, tracking_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'sent', $8, $9)
       RETURNING id`,
      [campaignId, recipientId, recipient.email, subject, campaign.from_email,
       smtpServer.id, smtpServer.name, result.messageId, recipient.tracking_token]
    );

    // Emit real-time update
    if (io) {
      io.to(`campaign:${campaignId}`).emit('email:sent', {
        logId: logResult.rows[0].id,
        recipient: recipient.email,
        status: 'sent',
        timestamp: new Date().toISOString(),
        smtp: smtpServer.name,
        messageId: result.messageId
      });
    }

    return { success: true, messageId: result.messageId };

  } catch (error) {
    // Update recipient with failure
    await db.query(
      `UPDATE recipients SET status = 'failed', error_message = $1, retry_count = retry_count + 1
       WHERE id = $2`,
      [error.message, recipientId]
    );

    await db.query(
      'UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = $1',
      [campaignId]
    );

    // Create failure log
    const logResult = await db.query(
      `INSERT INTO email_logs (campaign_id, recipient_id, recipient_email, status, error_message)
       VALUES ($1, $2, (SELECT email FROM recipients WHERE id = $2), 'failed', $3)
       RETURNING id`,
      [campaignId, recipientId, error.message]
    );

    if (io) {
      io.to(`campaign:${campaignId}`).emit('email:failed', {
        logId: logResult.rows[0].id,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }

    logger.error('Email send failed in queue', {
      recipientId,
      campaignId,
      error: error.message
    });

    throw error; // BullMQ will retry based on config
  }
}, {
  connection: redis,
  concurrency: 10,
  limiter: {
    max: parseInt(process.env.DEFAULT_THROTTLE) || 30,
    duration: 60000
  }
});

worker.on('completed', (job) => {
  logger.debug(`Job ${job.id} completed successfully`);
});

worker.on('failed', (job, err) => {
  logger.error(`Job ${job.id} failed after ${job.attemptsMade} attempts`, {
    error: err.message
  });
});

module.exports = { emailQueue, worker };