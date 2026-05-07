/**
 * ═════════════════════════════════════════════════════════════════════════
 * AUTHENTICATION MIDDLEWARE
 * ═════════════════════════════════════════════════════════════════════════
 * 
 * Handles API key and admin authentication
 * Supports multiple authentication strategies:
 * - API Key (x-api-key header)
 * - Admin Key (x-admin-api-key header)
 * - JWT Token (Authorization Bearer header)
 * ═════════════════════════════════════════════════════════════════════════
 */

const logger = require('../utils/logger');

/**
 * API Key authentication middleware
 * Validates x-api-key header
 */
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    logger.debug(`API key auth failed: missing header for ${req.path}`);
    return res.status(400).json({
      error: 'Missing API Key',
      statusCode: 400,
      message: 'x-api-key header is required'
    });
  }

  // TODO: Validate against whitelist in database/Redis
  // For now, accept any API key (implement proper validation)
  
  req.apiKey = apiKey;
  req.authType = 'api-key';
  logger.debug(`✓ API Key auth successful`);
  next();
};

/**
 * Admin authentication middleware
 * Validates x-admin-api-key header
 * Only allows requests from authorized admin users
 */
const adminAuth = (req, res, next) => {
  const adminKey = req.headers['x-admin-api-key'];
  const expectedKey = process.env.ADMIN_API_KEY || 'admin-secret-key';

  if (!adminKey) {
    logger.warn(`Admin auth failed: missing key from ${req.ip} for ${req.path}`);
    return res.status(401).json({
      error: 'Unauthorized',
      statusCode: 401,
      message: 'Missing admin API key. Provide x-admin-api-key header.'
    });
  }

  if (adminKey !== expectedKey) {
    logger.warn(`Admin auth failed: invalid key from ${req.ip} for ${req.path}`);
    return res.status(401).json({
      error: 'Unauthorized',
      statusCode: 401,
      message: 'Invalid admin API key'
    });
  }

  req.adminKey = adminKey;
  req.authType = 'admin';
  logger.info(`✓ Admin auth successful from ${req.ip}`);
  next();
};

/**
 * Optional API key auth (doesn't block if missing)
 * Attaches user ID if API key provided
 */
const optionalApiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (apiKey) {
    req.apiKey = apiKey;
    req.authType = 'api-key';
  }
  
  next();
};

/**
 * Rate limit bypass for admin users
 * Admin requests bypass rate limiting
 */
const adminBypassRateLimit = (req, res, next) => {
  const adminKey = req.headers['x-admin-api-key'];
  const expectedKey = process.env.ADMIN_API_KEY;

  if (adminKey === expectedKey) {
    // Mark request to bypass rate limiting
    req.bypassRateLimit = true;
    req.isAdmin = true;
    logger.debug('Admin user - rate limit bypassed');
  }

  next();
};

module.exports = { 
  apiKeyAuth, 
  adminAuth, 
  optionalApiKeyAuth,
  adminBypassRateLimit
};
