const { parse } = require('csv-parse/sync');
const fs = require('fs');
const crypto = require('crypto');

class ImporterService {
  static parseCSV(filePath, options = {}) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      ...options
    });
    return records;
  }

  static parseTXT(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    return lines.map(line => {
      // Support format: email, firstName, lastName or just email
      const parts = line.split(',').map(s => s.trim());
      if (parts.length === 1) {
        return { email: parts[0] };
      }
      return {
        email: parts[0],
        first_name: parts[1] || '',
        last_name: parts[2] || ''
      };
    });
  }

  static generateTrackingToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  static parseManualInput(text, delimiter = '\n') {
    const lines = text.split(delimiter).filter(line => line.trim());
    return lines.map(line => {
      const parts = line.split(',').map(s => s.trim());
      if (parts.length === 1) {
        return { email: parts[0] };
      }
      return {
        email: parts[0],
        first_name: parts[1] || '',
        last_name: parts[2] || ''
      };
    });
  }

  static prepareRecipients(rawRecipients, campaignId) {
    return rawRecipients.map(r => ({
      campaign_id: campaignId,
      email: r.email.toLowerCase().trim(),
      first_name: r.first_name || r.firstName || '',
      last_name: r.last_name || r.lastName || '',
      custom_fields: JSON.stringify(r.custom_fields || {}),
      status: 'pending',
      tracking_token: this.generateTrackingToken()
    }));
  }
}

module.exports = ImporterService;