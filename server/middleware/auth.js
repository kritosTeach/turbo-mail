const jwt = require('jsonwebtoken');

function isAuthenticated(req, res, next) {
  // Check session-based auth first
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
// في ملف auth logic عند إنشاء الـ token
const token = jwt.sign(
  { id: user.id }, 
  process.env.JWT_SECRET, 
  { expiresIn: '24h' } // تأكد أن المدة كافية مثل 24 ساعة
);
  // Check API key
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    try {
      // Validate API key against DB
      const db = require('../config/database');
      db.query('SELECT id, username, role FROM users WHERE api_key = $1', [apiKey])
        .then(result => {
          if (result.rows.length > 0) {
            req.user = result.rows[0];
            req.api_auth = true;
            return next();
          }
          return res.status(401).json({ error: 'Invalid API key' });
        })
        .catch(() => res.status(500).json({ error: 'Auth error' }));
    } catch (err) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    return;
  }

  // Check JWT
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'jwt-secret');
      req.user = decoded;
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  return res.status(401).json({ error: 'Authentication required' });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function optionalAuth(req, res, next) {
  if (req.headers.authorization || req.headers['x-api-key']) {
    return isAuthenticated(req, res, next);
  }
  next();
}

module.exports = { isAuthenticated, requireRole, optionalAuth };