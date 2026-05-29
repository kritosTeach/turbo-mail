const nodemailer = require('nodemailer');
const db = require('../config/database');
const { decrypt } = require('../utils/encryption');
const logger = require('../utils/logger');

class MailerService {
  constructor() {
    this.transporters = new Map();
  }

  async getTransporter(smtpId) {
    if (this.transporters.has(smtpId)) {
      return this.transporters.get(smtpId);
    }

    const result = await db.query('SELECT * FROM smtp_servers WHERE id = $1 AND is_active = true', [smtpId]);
    if (result.rows.length === 0) {
      throw new Error('SMTP server not found or inactive');
    }

    const config = result.rows[0];
    let transporterConfig;

    if (config.auth_method === 'none' || config.auth_method === 'anonymous') {
      transporterConfig = {
        host: config.host,
        port: config.port,
        secure: config.encryption === 'ssl',
        ignoreTLS: config.encryption === 'none',
        requireTLS: config.encryption === 'starttls',
        tls: {
          rejectUnauthorized: false
        }
      };
    } else {
      const password = decrypt(config.password_encrypted);
      transporterConfig = {
        host: config.host,
        port: config.port,
        secure: config.encryption === 'ssl',
        ignoreTLS: config.encryption === 'none',
        requireTLS: config.encryption === 'starttls',
        auth: {
          user: config.username,
          pass: password
        },
        tls: {
          rejectUnauthorized: false
        },
        pool: true,
        maxConnections: config.max_connections || 5,
        maxMessages: 100
      };
    }

    const transporter = nodemailer.createTransport(transporterConfigipse);
    this.transporters.set(smtpId, transporter);
    return transporter;
  }

  async sendEmail(smtpId, mailOptions) {
    const transporter = await this.getTransporter(smtpId);
    try {
      const info = await transporter.sendMail(mailOptions);

      // Update SMTP last used
      await db.query(
        'UPDATE smtp_servers SET last_used_at = NOW(), fail_count = 0 WHERE id = $1',
        [smtpId]
      );

      return {
        success: true,
        messageId: info.messageId,
        response: info.response,
        accepted: info.accepted,
        rejected: info.rejected
      };
    } catch (error) {
      // Increment fail count
      await db.query(
        'UPDATE smtp_servers SET fail_count = fail_count + 1 WHERE id = $1',
        [smtpId]
      );

      logger.error('SMTP send failed', {
        smtpId,
        error: error.message,
        code: error.code
      });

      throw error;
    }
  }

  async testConnection(smtpId) {
    try {
      const transporter = await this.getTransporter(smtpId);
      const verified = await transporter.verify();
      return { success: true, message: 'SMTP connection successful' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async findNextSmtp(excludeId = null) {
    let query = 'SELECT * FROM smtp_servers WHERE is_active = true';
    let params = [];

    if (excludeId) {
      params.push(excludeId);
      query += ` AND id != $1`;
    }

    query += ' ORDER BY priority ASC, fail_count ASC, last_used_at ASC NULLS FIRST LIMIT 1';

    const result = await db.query(query, params);
    return result.rows[0] || null;
  }

  clearTransporter(smtpId) {
    if (this.transporters.has(smtpId)) {
      this.transporters.get(smtpId).close();
      this.transporters.delete(smtpId);
    }
  }
}

module.exports = new MailerService();