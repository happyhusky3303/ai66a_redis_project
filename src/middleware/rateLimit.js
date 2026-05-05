const redisScripts = require('../utils/redisScripts');
const { logRequest } = require('../services/mongodb');
const { query } = require('../services/postgres');
const logger = require('../utils/logger');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const persistRateLimitStats = async (userId, windowSeconds, allowed, blocked) => {
  if (!UUID_REGEX.test(userId)) {
    return;
  }

  const userExists = await query('SELECT 1 FROM users WHERE id = $1', [userId]);
  if (userExists.rows.length === 0) {
    return;
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - (windowSeconds * 1000));

  await query(
    `INSERT INTO rate_limit_stats (user_id, window_start, window_end, requests_allowed, requests_blocked)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, windowStart, now, allowed, blocked]
  );
};

const rateLimitMiddleware = async (req, res, next) => {
  try {
    // Generate or get user ID from request
    let userId = req.headers['x-user-id'] || req.ip;
    req.userId = userId;

    const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || process.env.RATE_LIMIT_MAX_VOTES, 10) || 100;
    const windowSeconds = parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS) || 60;

    // Check rate limit using Lua script
    const rateLimitResult = await redisScripts.slidingWindowRateLimit(
      userId,
      maxRequests,
      windowSeconds,
      1 // Request count
    );

    req.rateLimitInfo = rateLimitResult;
    persistRateLimitStats(userId, windowSeconds, rateLimitResult.allowed, rateLimitResult.blocked)
      .catch(err => logger.debug(`Failed to persist rate limit stats: ${err.message}`));

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
