/**
 * ═════════════════════════════════════════════════════════════════════════
 * API ROUTES - RESTful Endpoints
 * ═════════════════════════════════════════════════════════════════════════
 * 
 * Implements the following flow:
 * 1. Rate Limiting (Redis Lua - middleware)
 * 2. Cache Layer (Redis - middleware)
 * 3. Authentication (x-api-key header)
 * 4. Business Logic (VotingService)
 * 5. PostgreSQL Sync (automatic)
 * 6. Cache Invalidation (on write)
 * 7. MongoDB Logging (asynchronous)
 * ═════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const votingService = require('../services/voting');
const cacheService = require('../services/cache');
const { cacheLayerMiddleware, cacheInvalidationMiddleware, getCacheStats } = require('../middleware/cacheLayer');
const { logRequest } = require('../services/mongodb');
const { query } = require('../services/postgres');
const logger = require('../utils/logger');

const router = express.Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ═════════════════════════════════════════════════════════════════════════
// HEALTH CHECK ENDPOINT
// ═════════════════════════════════════════════════════════════════════════

/**
 * GET /api/health
 * Check system health and connection status
 */
router.get('/health', async (req, res) => {
  const startTime = Date.now();

  try {
    let postgresStatus = 'disconnected';
    let mongodbStatus = 'disconnected';

    // Test PostgreSQL
    try {
      await query('SELECT 1');
      postgresStatus = 'connected';
    } catch (error) {
      logger.debug(`Health check PostgreSQL failed: ${error.message}`);
    }

    // Test MongoDB (getDB function will throw if not connected)
    try {
      const { getDB } = require('../services/mongodb');
      getDB();
      mongodbStatus = 'connected';
    } catch (error) {
      logger.debug(`Health check MongoDB failed: ${error.message}`);
    }

    const responseTime = Date.now() - startTime;

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      responseTime,
      databases: {
        postgres: postgresStatus,
        mongodb: mongodbStatus,
        redis: 'connected'
      },
      rateLimitInfo: req.rateLimitInfo
    });
  } catch (error) {
    logger.error('Health check error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

/**
 * GET /api/cache/stats
 * Public cache statistics for dashboard widgets
 */
router.get('/cache/stats', async (req, res) => {
  try {
    const stats = await cacheService.getAllCacheStats();
    const totalHits = stats.reduce((sum, entry) => sum + (entry.hits || 0), 0);
    const totalMisses = stats.reduce((sum, entry) => sum + (entry.misses || 0), 0);
    const totalRequests = totalHits + totalMisses;

    res.json({
      success: true,
      cacheStats: stats,
      summary: {
        totalKeys: stats.length,
        totalHits,
        totalMisses,
        hitRate: totalRequests > 0
          ? `${((totalHits / totalRequests) * 100).toFixed(2)}%`
          : '0.00%'
      }
    });
  } catch (error) {
    logger.error('Cache stats endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load cache statistics'
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════
// VOTING ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════

/**
 * POST /api/vote
 * 
 * Cast a vote for an item
 * 
 * Request flow:
 * 1. Rate limiting check (middleware) → 429 if exceeded
 * 2. Validate input (userId, itemId, voteValue)
 * 3. Execute voting via Redis Lua script (atomic)
 * 4. Sync to PostgreSQL (UPSERT)
 * 5. Invalidate caches
 * 6. Log to MongoDB (async)
 * 
 * Request body:
 * {
 *   "userId": "user-id",
 *   "itemId": "item-id", 
 *   "voteValue": 1
 * }
 */
router.post('/vote', async (req, res, next) => {
  const startTime = Date.now();

  try {
    const { userId, itemId } = req.body;
    let voteValue = Number.isInteger(req.body.voteValue) ? req.body.voteValue : 1;

    // ─────────────── INPUT VALIDATION ───────────────
    if (!userId || !itemId) {
      return res.status(400).json({
        error: 'Validation Error',
        statusCode: 400,
        message: 'Missing required fields: userId, itemId',
        fields: {
          userId: !userId ? 'required' : 'ok',
          itemId: !itemId ? 'required' : 'ok'
        }
      });
    }

    if (!Number.isInteger(voteValue) || Math.abs(voteValue) > 10) {
      return res.status(400).json({
        error: 'Validation Error',
        statusCode: 400,
        message: 'voteValue must be integer between -10 and 10'
      });
    }

    // ─────────────── ENSURE USER EXISTS ───────────────
    let userIdFromDB = userId;

    if (!UUID_REGEX.test(userId)) {
      // Create or get user
      try {
        const userResult = await query(
          `INSERT INTO users (username, email) VALUES ($1, $2)
           ON CONFLICT (username) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
           RETURNING id`,
          [userId, `${userId}@voting.local`]
        );
        userIdFromDB = userResult.rows[0].id;
      } catch (error) {
        logger.error('User creation error:', error);
        userIdFromDB = userId; // Fall back to provided ID
      }
    }

    // ─────────────── EXECUTE VOTING ───────────────
    const voteResult = await votingService.vote(userIdFromDB, itemId, voteValue);

    const responseTime = Date.now() - startTime;

    // Return response
    res.json({
      ...voteResult,
      rateLimitInfo: {
        allowed: req.rateLimitInfo?.allowed || 1,
        blocked: req.rateLimitInfo?.blocked || 0,
        remaining: req.rateLimitInfo?.remaining || 99
      }
    });

  } catch (error) {
    logger.error('Vote endpoint error:', error);
    const statusCode = error.statusCode || 500;
    
    res.status(statusCode).json({
      error: error.message || 'Vote failed',
      statusCode,
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
});

/**
 * GET /api/item/:id
 * Get item details with vote count and rank
 * 
 * Returns:
 * {
 *   "id": "item-id",
 *   "title": "Item Title",
 *   "score": 42,
 *   "rank": 5
 * }
 */
router.get('/item/:id', 
  cacheLayerMiddleware(req => `cache:item:${req.params.id}`),
  async (req, res, next) => {
    try {
      const item = await votingService.getItem(req.params.id);

      res.json({
        success: true,
        data: item,
        cached: req.headers['x-cache-hit'] === 'true'
      });
    } catch (error) {
      logger.error('GetItem error:', error);
      next(error);
    }
  }
);

/**
 * GET /api/ranking
 * Get leaderboard (top N items by vote count)
 * 
 * Query params:
 * - limit: Number of items (default: 10, max: 100)
 * - offset: Pagination offset (default: 0)
 * 
 * Returns:
 * {
 *   "items": [
 *     { "id": "item-1", "score": 100, "rank": 1 },
 *     ...
 *   ],
 *   "pagination": { "limit": 10, "offset": 0 }
 * }
 */
router.get('/ranking',
  cacheLayerMiddleware(req => {
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    return `cache:ranking:${limit}:${offset}`;
  }),
  async (req, res, next) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 10, 100);
      const offset = Math.max(parseInt(req.query.offset) || 0, 0);

      const items = await votingService.getTopItems(limit, offset);

      res.json({
        success: true,
        data: items,
        pagination: {
          limit,
          offset,
          count: items.length
        },
        cached: false
      });
    } catch (error) {
      logger.error('GetRanking error:', error);
      next(error);
    }
  }
);

/**
 * GET /api/user/:userId/votes
 * Get all votes cast by a user
 */
router.get('/user/:userId/votes', async (req, res, next) => {
  try {
    const votes = await votingService.getUserVotes(req.params.userId);

    res.json({
      success: true,
      userId: req.params.userId,
      votes,
      count: votes.length
    });
  } catch (error) {
    logger.error('GetUserVotes error:', error);
    next(error);
  }
});

/**
 * GET /api/stats
 * Get system statistics
 */
router.get('/stats', async (req, res, next) => {
  try {
    const votingStats = await votingService.getVotingStats();
    const cacheStats = await getCacheStats();

    res.json({
      success: true,
      voting: votingStats,
      cache: {
        hits: cacheStats.total_hits || 0,
        misses: cacheStats.total_misses || 0,
        hitRate: cacheStats.total_hits && cacheStats.total_misses 
          ? (cacheStats.total_hits / (cacheStats.total_hits + cacheStats.total_misses) * 100).toFixed(2) + '%'
          : 'N/A'
      }
    });
  } catch (error) {
    logger.error('GetStats error:', error);
    next(error);
  }
});

/**
 * GET /api/items
 * Get all votable items (regardless of vote count)
 *
 * Query params:
 * - limit: Max rows to return (default: 200, max: 500)
 * - offset: Pagination offset (default: 0)
 */
router.get('/items', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const result = await query(
      `SELECT id, title, description, score, created_at, updated_at
       FROM items
       ORDER BY title ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({
      success: true,
      items: result.rows.map(item => ({
        ...item,
        score: parseInt(item.score || 0, 10)
      })),
      count: result.rows.length
    });
  } catch (error) {
    logger.error('GetItems error:', error);
    next(error);
  }
});

module.exports = router;
