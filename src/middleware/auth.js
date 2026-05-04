/**
 * Authentication middleware for API
 */

const logger = require('../utils/logger');

const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(400).json({
      error: 'Missing API Key',
      message: 'x-api-key header is required'
    });
  }

  // In production, validate against a whitelist in database
  req.apiKey = apiKey;
  next();
};

const adminAuth = (req, res, next) => {
  const adminKey = req.headers['x-admin-api-key'];

  if (adminKey !== process.env.ADMIN_API_KEY) {
    logger.warn('Unauthorized admin access attempt', { 
      ip: req.ip,
      key: adminKey ? 'provided' : 'missing'
    });

    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing admin API key'
    });
  }

  next();
};

module.exports = { apiKeyAuth, adminAuth };
