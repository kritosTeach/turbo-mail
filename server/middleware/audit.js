const db = require('../config/database');

async function auditLog(req, action, resourceType, resourceId, details = {}) {
  try {
    await db.query(
      `INSERT INTO audit_logs (user_id, username, action, resource_type, resource_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.user?.id || null,
        req.user?.username || 'system',
        action,
        resourceType,
        resourceId ? String(resourceId) : null,
        JSON.stringify(details),
        req.ip
      ]
    );
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

module.exports = { auditLog };