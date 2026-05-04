const express = require('express');
const votingService = require('../services/voting');
const cacheLayer = require('../services/cache');
const { query } = require('../services/postgres');
const logger = require('../utils/logger');

const router = express.Router();

// ─────────────────── Health Check ──────────────
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    rateLimitInfo: req.rateLimitInfo
  });
});

// ─────────────────── Voting Endpoints ──────────────

/**
 * POST /api/vote
 * Cast a vote for an item
 */
router.post('/vote', async (req, res, next) => {
  try {
    const { userId, itemId, voteValue = 1 } = req.body;

    // Validation
    if (!userId || !itemId) {
      return res.status(400).json({
        error: 'Missing required fields: userId, itemId'
      });
    }

    // Check if item exists
    const itemResult = await query('SELECT id FROM items WHERE id = $1', [itemId]);
    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Get or create user
    const userResult = await query(
      `INSERT INTO users (username, email) VALUES ($1, $2)
       ON CONFLICT (username) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [userId, `${userId}@voting.local`]
    );

    const userIdFromDB = userResult.rows[0].id;

    // Cast vote
    const voteResult = await votingService.vote(userIdFromDB, itemId, voteValue);

    res.json({
      success: true,
      vote: voteResult,
      rateLimitInfo: {
        allowed: req.rateLimitInfo.allowed,
        blocked: req.rateLimitInfo.blocked,
        resetIn: req.rateLimitInfo.ttl
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/item/:id
 * Get item details with vote count and rank
 */
router.get('/item/:id', async (req, res, next) => {
  try {
    const item = await votingService.getItem(req.params.id);

    res.json({
      success: true,
      item,
      cached: req.query.cached !== 'false'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/ranking
 * Get top N items (leaderboard)
 */
router.get('/ranking', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const items = await votingService.getTopItems(limit, offset);

    res.json({
      success: true,
      items,
      pagination: { limit, offset, total: items.length },
      cached: true
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/user/:userId/votes
 * Get user votes
 */
router.get('/user/:userId/votes', async (req, res, next) => {
  try {
    const votes = await votingService.getUserVotes(req.params.userId);

    res.json({
      success: true,
      votes
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────── Cache Endpoints ──────────────

/**
 * GET /api/cache/stats
 * Get cache statistics
 */
router.get('/cache/stats', async (req, res, next) => {
  try {
    const stats = await cacheLayer.getAllCacheStats();

    res.json({
      success: true,
      cacheStats: stats,
      summary: {
        totalKeys: stats.length,
        totalHits: stats.reduce((sum, s) => sum + s.hits, 0),
        totalMisses: stats.reduce((sum, s) => sum + s.misses, 0),
        hitRate: stats.length > 0 
          ? ((stats.reduce((sum, s) => sum + s.hits, 0) / 
              (stats.reduce((sum, s) => sum + s.hits + s.misses, 0) || 1)) * 100).toFixed(2) + '%'
          : '0%'
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/cache/invalidate/:key
 * Invalidate a cache key
 */
router.post('/cache/invalidate/:key', async (req, res, next) => {
  try {
    const { key } = req.params;
    const deleted = await cacheLayer.delete(`cache:${key}`);

    res.json({
      success: true,
      deleted
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────── Rate Limit Stats ──────────────

/**
 * GET /api/rate-limit/stats
 * Get rate limit statistics
 */
router.get('/rate-limit/stats', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT user_id, 
              COUNT(*) as total_requests,
              SUM(CASE WHEN requests_blocked > 0 THEN 1 ELSE 0 END) as blocked_windows,
              SUM(requests_blocked) as total_blocked
       FROM rate_limit_stats
       GROUP BY user_id
       ORDER BY total_blocked DESC
       LIMIT 20`
    );

    res.json({
      success: true,
      stats: result.rows
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────── System Endpoints ──────────────

/**
 * POST /api/sync/votes
 * Sync Redis voting data to PostgreSQL
 */
router.post('/sync/votes', async (req, res, next) => {
  try {
    const synced = await votingService.syncVotesToPostgres();

    res.json({
      success: true,
      synced
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/stats/summary
 * Get system summary statistics
 */
router.get('/stats/summary', async (req, res, next) => {
  try {
    // Get user count
    const usersResult = await query('SELECT COUNT(*) as count FROM users');

    // Get total votes
    const votesResult = await query('SELECT COUNT(*) as count FROM votes');

    // Get total items
    const itemsResult = await query('SELECT COUNT(*) as count FROM items');

    // Get cache stats
    const cacheStats = await cacheLayer.getAllCacheStats();
    const totalCacheHits = cacheStats.reduce((sum, s) => s.hits, 0);

    res.json({
      success: true,
      summary: {
        users: parseInt(usersResult.rows[0].count),
        votes: parseInt(votesResult.rows[0].count),
        items: parseInt(itemsResult.rows[0].count),
        cacheKeys: cacheStats.length,
        cacheHits: totalCacheHits
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
