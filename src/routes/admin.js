const express = require('express');
const { getRedisClient } = require('../services/redis');
const { query } = require('../services/postgres');
const cacheLayer = require('../services/cache');
const logger = require('../utils/logger');
const { verifyToken, getBearerToken, hashPassword } = require('../services/auth');

const router = express.Router();

const parseRedisInfo = (infoText) => {
  if (!infoText || typeof infoText !== 'string') {
    return {};
  }

  const parsed = {};
  for (const line of infoText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex);
    const value = trimmed.slice(separatorIndex + 1);
    parsed[key] = value;
  }

  return parsed;
};

// ─────────────────── Admin Authentication ──────────────

const adminAuth = (req, res, next) => {
  const bearer = getBearerToken(req);
  if (bearer) {
    try {
      const payload = verifyToken(bearer);
      if (payload.role === 'admin') {
        req.adminUser = payload;
        return next();
      }
      return res.status(403).json({ error: 'Forbidden: admin role required' });
    } catch (error) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const apiKey = req.headers['x-admin-api-key'];

  if (apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
};

router.use(adminAuth);

// ─────────────────── Rate Limit Monitoring ──────────────

/**
 * GET /admin/api/rate-limits
 * Get all active rate limits
 */
router.get('/rate-limits', async (req, res, next) => {
  try {
    const client = getRedisClient();
    const keys = await client.keys('rate_limit:*');

    const rateLimits = [];

    for (const key of keys) {
      const userId = key.replace('rate_limit:', '');
      const statsKey = `rate_limit_stats:${userId}`;
      const stats = await client.hGetAll(statsKey);

      const count = await client.zCard(key);
      const ttl = await client.ttl(key);

      rateLimits.push({
        userId,
        activeRequests: count,
        allowed: parseInt(stats.allowed) || 0,
        blocked: parseInt(stats.blocked) || 0,
        ttl: ttl === -1 ? 'no expiry' : `${ttl}s`
      });
    }

    res.json({
      success: true,
      rateLimits: rateLimits.sort((a, b) => b.blocked - a.blocked),
      total: rateLimits.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/api/rate-limit/user/:userId
 * Get detailed rate limit info for a user
 */
router.get('/rate-limit/user/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const client = getRedisClient();

    const key = `rate_limit:${userId}`;
    const statsKey = `rate_limit_stats:${userId}`;

    const count = await client.zCard(key);
    const stats = await client.hGetAll(statsKey);
    const ttl = await client.ttl(key);
    const requests = await client.zRangeWithScores(key, 0, -1);

    res.json({
      success: true,
      rateLimitInfo: {
        userId,
        activeRequests: count,
        allowed: parseInt(stats.allowed) || 0,
        blocked: parseInt(stats.blocked) || 0,
        ttl: ttl === -1 ? 'no expiry' : ttl,
        requests: requests.map(r => ({
          timestamp: new Date(parseInt(r.score)),
          score: r.score
        }))
      }
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────── Cache Management ──────────────

/**
 * GET /admin/api/cache/keys
 * Get all cache keys
 */
router.get('/cache/keys', async (req, res, next) => {
  try {
    const client = getRedisClient();
    const keys = await client.keys('cache:*');

    res.json({
      success: true,
      cacheKeys: keys,
      total: keys.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/api/cache/stats
 * Get detailed cache statistics
 */
router.get('/cache/stats', async (req, res, next) => {
  try {
    const stats = await cacheLayer.getAllCacheStats();
    const client = getRedisClient();
    const memoryInfo = await client.info('memory');
    const totalHits = stats.reduce((sum, s) => sum + (s.hits || 0), 0);
    const totalMisses = stats.reduce((sum, s) => sum + (s.misses || 0), 0);
    const totalRequests = totalHits + totalMisses;
    const activeKeys = stats.filter((entry) => entry.exists !== false).length;

    res.json({
      success: true,
      cacheStats: stats,
      memory: memoryInfo,
      summary: {
        totalKeys: activeKeys,
        totalHits,
        totalMisses,
        hitRate: totalRequests > 0
          ? `${((totalHits / totalRequests) * 100).toFixed(2)}%`
          : '0.00%'
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /admin/api/cache/key/:key
 * Delete a specific cache key
 */
router.delete('/cache/key/:key', async (req, res, next) => {
  try {
    const { key } = req.params;
    const client = getRedisClient();
    const normalizedKey = key.startsWith('cache:') ? key : `cache:${key}`;

    await client.del(normalizedKey);

    res.json({
      success: true,
      message: `Cache key '${normalizedKey}' deleted`
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/api/cache/clear
 * Clear all caches
 */
router.post('/cache/clear', async (req, res, next) => {
  try {
    const cleared = await cacheLayer.invalidatePattern('cache:*');

    res.json({
      success: true,
      cleared
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────── System Monitoring ──────────────

/**
 * GET /admin/api/system/stats
 * Get system statistics
 */
router.get('/system/stats', async (req, res, next) => {
  try {
    const client = getRedisClient();

    // Get Redis info
    const redisInfo = parseRedisInfo(await client.info());
    const memoryInfo = parseRedisInfo(await client.info('memory'));

    // Get database stats
    const usersCount = await query('SELECT COUNT(*) as count FROM users');
    const votesCount = await query('SELECT COUNT(*) as count FROM votes');
    const itemsCount = await query('SELECT COUNT(*) as count FROM items');

    res.json({
      success: true,
      system: {
        redis: {
          version: redisInfo.redis_version || 'unknown',
          usedMemory: memoryInfo.used_memory_human || 'unknown'
        },
        database: {
          users: parseInt(usersCount.rows[0].count),
          votes: parseInt(votesCount.rows[0].count),
          items: parseInt(itemsCount.rows[0].count)
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/api/logs
 * Get API logs
 */
router.get('/logs', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 1000);

    const result = await query(
      `SELECT id, user_id, endpoint, method, status_code, response_time_ms, rate_limited, created_at
       FROM api_logs
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    res.json({
      success: true,
      logs: result.rows
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────── User Management ──────────────

/**
 * GET /admin/api/users
 * Get all users
 */
router.get('/users', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 1000);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const result = await query(
      `SELECT
         u.id,
         u.username,
         u.email,
         u.full_name,
         u.role,
         u.last_login_at,
         u.created_at,
         u.updated_at,
         COUNT(v.id)::int AS vote_count
       FROM users u
       LEFT JOIN votes v ON v.user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await query('SELECT COUNT(*) as count FROM users');

    res.json({
      success: true,
      users: result.rows,
      pagination: {
        limit,
        offset,
        total: parseInt(countResult.rows[0].count)
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/api/user
 * Create a user from the admin panel.
 */
router.post('/user', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    const email = String(req.body.email || '').trim().toLowerCase();
    const fullName = String(req.body.fullName || '').trim() || null;
    const role = req.body.role === 'admin' ? 'admin' : 'user';
    const password = req.body.password || process.env.DEFAULT_USER_PASSWORD || 'Legacy@123';

    if (!username || !email) {
      return res.status(400).json({ error: 'username and email are required' });
    }

    const result = await query(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO UPDATE SET
         email = EXCLUDED.email,
         full_name = EXCLUDED.full_name,
         role = EXCLUDED.role,
         password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash),
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, username, email, full_name, role, last_login_at, created_at, updated_at`,
      [username, email, hashPassword(password), fullName, role]
    );

    res.status(201).json({
      success: true,
      user: {
        ...result.rows[0],
        vote_count: 0
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/api/user/:userId
 * Get user details
 */
router.get('/user/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;

    const userResult = await query(
      `SELECT id, username, email, full_name, role, last_login_at, created_at, updated_at
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const votesResult = await query(
      'SELECT COUNT(*) as count FROM votes WHERE user_id = $1',
      [userId]
    );

    const user = userResult.rows[0];
    user.voteCount = parseInt(votesResult.rows[0].count);

    res.json({
      success: true,
      user
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────── Items Management ──────────────

/**
 * GET /admin/api/items
 * Get all items
 */
router.get('/items', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, title, description, score, rank, created_at, updated_at
       FROM items
       ORDER BY score DESC`
    );

    res.json({
      success: true,
      items: result.rows
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/api/item
 * Create a new item
 */
router.post('/item', async (req, res, next) => {
  try {
    const { title, description } = req.body;

    const result = await query(
      `INSERT INTO items (title, description) 
       VALUES ($1, $2)
       RETURNING id, title, description, score, created_at`,
      [title, description]
    );

    res.json({
      success: true,
      item: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
