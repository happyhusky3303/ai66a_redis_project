const { getRedisClient } = require('../services/redis');
const redisScripts = require('../utils/redisScripts');
const { logRequest } = require('../services/mongodb');
const logger = require('../utils/logger');

const rateLimitMiddleware = async (req, res, next) => {
  try {
    // Generate or get user ID from request
    let userId = req.headers['x-user-id'] || req.ip;
    req.userId = userId;

    const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100;
    const windowSeconds = parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS) || 60;
    const partialAccept = process.env.RATE_LIMIT_PARTIAL_ACCEPT === 'true';

    // Check rate limit using Lua script
    const rateLimitResult = await redisScripts.slidingWindowRateLimit(
      userId,
      maxRequests,
      windowSeconds,
      1 // Request count
    );

    req.rateLimitInfo = rateLimitResult;

    // If request is blocked
    if (rateLimitResult.allowed === 0) {
      const logData = {
        userId,
        endpoint: req.path,
        method: req.method,
        status: 429,
        rateLimited: true,
        ip: req.ip,
        userAgent: req.get('user-agent')
      };

      // Log asynchronously (don't block response)
      logRequest(logData).catch(err => logger.error('Failed to log request:', err));

      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Max ${maxRequests} requests per ${windowSeconds} seconds.`,
        retryAfter: rateLimitResult.ttl,
        rateLimitInfo: {
          allowed: rateLimitResult.allowed,
          blocked: rateLimitResult.blocked,
          resetIn: rateLimitResult.ttl
        }
      });
    }

    // Request allowed
    req.rateLimitStatus = 'allowed';

    // Log allowed request asynchronously
    logRequest({
      userId,
      endpoint: req.path,
      method: req.method,
      status: 200,
      rateLimited: false,
      ip: req.ip,
      userAgent: req.get('user-agent')
    }).catch(err => logger.error('Failed to log request:', err));

    next();
  } catch (error) {
    logger.error('Rate limit middleware error:', error);
    // Don't block the request if rate limiting fails
    next();
  }
};

module.exports = rateLimitMiddleware;
