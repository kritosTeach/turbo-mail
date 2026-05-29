const dns = require('dns').promises;

class EmailValidator {
  static EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

  static validateEmail(email) {
    if (!email || typeof email !== 'string') {
      return { valid: false, reason: 'Email is required' };
    }

    const cleaned = email.trim().toLowerCase();

    if (cleaned.length > 254) {
      return { valid: false, reason: 'Email too long' };
    }

    if (!this.EMAIL_REGEX.test(cleaned)) {
      return { valid: false, reason: 'Invalid email format' };
    }

    return { valid: true, email: cleaned };
  }

  static async validateEmailWithMX(email) {
    const basic = this.validateEmail(email);
    if (!basic.valid) return basic;

    const domain = basic.email.split('@')[1];
    try {
      const mxRecords = await dns.resolveMx(domain);
      if (mxRecords && mxRecords.length > 0) {
        return { ...basic, mx: true, mxRecords };
      }
      return { ...basic, mx: false, reason: 'No MX records found for domain' };
    } catch (err) {
      return { ...basic, mx: false, reason: `DNS lookup failed: ${err.message}` };
    }
  }

  static validateBatch(emails, checkMx = false) {
    const results = { valid: [], invalid: [], mxFail: [] };

    for (const email of emails) {
      const validation = this.validateEmail(email);
      if (validation.valid) {
        if (checkMx) {
          // Will be validated asynchronously
          results.valid.push(validation.email);
        } else {
          results.valid.push(validation.email);
        }
      } else {
        results.invalid.push({ email, reason: validation.reason });
      }
    }

    return results;
  }
}

module.exports = EmailValidator;