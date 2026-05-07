/**
 * ═════════════════════════════════════════════════════════════════════════
 * REDIS RATE LIMITING MIDDLEWARE
 * ═════════════════════════════════════════════════════════════════════════
 * 
 * Implements sliding window rate limiting using Redis Lua scripts
 * All operations are atomic and O(log N) complexity
 * 
 * Handles:
 * - Sliding window rate limit enforcement
 * - Request tracking and statistics
 * - Async logging to MongoDB
 * - Graceful degradation on Redis failure
 * ═════════════════════════════════════════════════════════════════════════
 */

const redisScripts = require('../utils/redisScripts');
const { logRequest } = require('../services/mongodb');
const { query } = require('../services/postgres');
const logger = require('../utils/logger');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Persist rate limit statistics to PostgreSQL for analytics
 * Non-blocking operation - runs in background
 */
const persistRateLimitStats = async (userId, windowSeconds, stats) => {
  try {
    if (!UUID_REGEX.test(userId)) {
      return;
    }

    // Check if user exists
    const userExists = await query('SELECT 1 FROM users WHERE id = $1', [userId]);
    if (userExists.rows.length === 0) {
      return;
    }

    const now = new Date();
    const windowStart = new Date(now.getTime() - (windowSeconds * 1000));

    await query(
      `INSERT INTO rate_limit_stats (user_id, window_start, window_end, requests_allowed, requests_blocked)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, window_start, window_end) DO UPDATE SET
       requests_allowed = EXCLUDED.requests_allowed,
       requests_blocked = EXCLUDED.requests_blocked`,
      [userId, windowStart, now, stats.allowed, stats.blocked]
    );
  } catch (error) {
    logger.debug(`Failed to persist rate limit stats for ${userId}: ${error.message}`);
  }
};

/**
 * Main rate limiting middleware
 * Checks if request is within rate limits before processing
 * 
 * Sets request properties:
 * - req.userId: Identified user (from header or IP)
 * - req.rateLimitInfo: Rate limit statistics
 * - req.rateLimitStatus: 'allowed' or 'blocked'
 */
const rateLimitMiddleware = async (req, res, next) => {
  const startTime = Date.now();
  
  try {
    // ─────────────── USER IDENTIFICATION ───────────────
    // Priority: x-user-id header > x-api-key > IP address
    let userId = req.headers['x-user-id'] || req.headers['x-api-key'] || req.ip;
    req.userId = userId;

    // ─────────────── CONFIGURATION ───────────────
    const maxRequests = parseInt(
      process.env.RATE_LIMIT_MAX_REQUESTS || 
      process.env.RATE_LIMIT_MAX_VOTES || 
      100
    );
    const windowSeconds = parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS) || 60;

    // ─────────────── REDIS RATE LIMIT CHECK ───────────────
    // Use Lua script for atomic sliding window implementation
    const rateLimitResult = await redisScripts.slidingWindowRateLimit(
      userId,
      maxRequests,
      windowSeconds,
      1  // Request count
    );

    // Attach rate limit info to request
    req.rateLimitInfo = rateLimitResult;

    // Persist stats asynchronously (non-blocking)
    persistRateLimitStats(userId, windowSeconds, {
      allowed: rateLimitResult.allowed,
      blocked: rateLimitResult.blocked
    }).catch(err => logger.debug('Stats persistence failed:', err.message));

    // ─────────────── RATE LIMIT ENFORCEMENT ───────────────
    if (rateLimitResult.allowed === 0) {
      req.rateLimitStatus = 'blocked';
      const responseTime = Date.now() - startTime;

      // Log blocked request to MongoDB
      const logData = {
        userId,
        endpoint: req.path,
        method: req.method,
        status: 429,
        statusCode: 429,
        rateLimited: true,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        responseTime
      };

      logRequest(logData).catch(err => 
        logger.debug('Failed to log blocked request:', err.message)
      );

      // Return 429 Too Many Requests
      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Max ${maxRequests} requests per ${windowSeconds}s.`,
        statusCode: 429,
        rateLimitInfo: {
          allowed: 0,
          blocked: 1,
          remaining: 0,
          resetIn: Math.ceil(rateLimitResult.retryAfter || windowSeconds),
          retryAfter: Math.ceil(rateLimitResult.retryAfter || windowSeconds)
        }
      });
    }

    // ─────────────── REQUEST ALLOWED ───────────────
    req.rateLimitStatus = 'allowed';

    // Log allowed request to MongoDB (async, non-blocking)
    const responseTime = Date.now() - startTime;
    logRequest({
      userId,
      endpoint: req.path,
      method: req.method,
      status: 200,
      statusCode: 200,
      rateLimited: false,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      responseTime
    }).catch(err => 
      logger.debug('Failed to log allowed request:', err.message)
    );

    // Proceed to next middleware/handler
    next();

  } catch (error) {
    logger.error('Rate limit middleware error:', {
      error: error.message,
      userId: req.headers['x-user-id'] || 'unknown',
      path: req.path
    });

    // FAIL OPEN: On Redis failure, allow request (safety first)
    // But log the error for monitoring
    req.rateLimitStatus = 'unknown';
    req.rateLimitInfo = {
      allowed: 1,
      blocked: 0,
      error: true
    };
    next();
  }
};

module.exports = rateLimitMiddleware;
