/**
 * ═════════════════════════════════════════════════════════════════════════
 * REDIS CACHE LAYER MIDDLEWARE
 * ═════════════════════════════════════════════════════════════════════════
 * 
 * Implements distributed caching with TTL and invalidation
 * Middleware for checking cache before processing requests
 * 
 * Handles:
 * - Cache hit/miss detection
 * - TTL management
 * - Cache statistics tracking
 * - Invalidation on data updates
 * ═════════════════════════════════════════════════════════════════════════
 */

const { getRedisClient } = require('../services/redis');
const logger = require('../utils/logger');

/**
 * Cache middleware for GET requests
 * Intercepts request to check if cached data exists
 * If cache hit, return immediately without further processing
 * If cache miss, attach cache key to request for later storage
 */
const cacheLayerMiddleware = (cacheKeyFn) => {
  return async (req, res, next) => {
    try {
      // Only cache GET requests
      if (req.method !== 'GET') {
        return next();
      }

      // Generate cache key based on request
      const cacheKey = cacheKeyFn ? cacheKeyFn(req) : generateCacheKey(req);
      
      if (!cacheKey) {
        return next();
      }

      req.cacheKey = cacheKey;

      // Try to get from cache
      const client = getRedisClient();
      const cachedData = await client.get(cacheKey);

      if (cachedData) {
        // ─────────────── CACHE HIT ───────────────
        try {
          const parsedData = JSON.parse(cachedData);
          
          // Log cache hit
          logger.debug(`Cache HIT: ${cacheKey}`);
          
          // Update cache statistics
          updateCacheStats(client, cacheKey, 'hit').catch(err => 
            logger.debug('Failed to update cache stats:', err.message)
          );

          // Return cached response
          return res.json({
            ...parsedData,
            cached: true,
            cacheKey,
            source: 'redis'
          });
        } catch (parseError) {
          // If cache is corrupted, delete it and continue
          logger.warn(`Cache parse error for ${cacheKey}:`, parseError.message);
          await client.del(cacheKey).catch(e => logger.debug('Failed to delete corrupted cache'));
        }
      }

      // ─────────────── CACHE MISS ───────────────
      logger.debug(`Cache MISS: ${cacheKey}`);
      updateCacheStats(client, cacheKey, 'miss').catch(err => 
        logger.debug('Failed to update cache stats:', err.message)
      );

      // Store original res.json to intercept response
      const originalJson = res.json.bind(res);
      
      res.json = function(data) {
        // After response is sent, cache the data
        cacheResponse(client, cacheKey, data).catch(err =>
          logger.debug(`Failed to cache response for ${cacheKey}:`, err.message)
        );
        return originalJson(data);
      };

      next();
    } catch (error) {
      logger.error('Cache middleware error:', error);
      // Fail open - continue request without caching
      next();
    }
  };
};

/**
 * Cache invalidation middleware
 * Called after POST/PUT/DELETE to invalidate affected caches
 */
const cacheInvalidationMiddleware = (invalidationFn) => {
  return async (req, res, next) => {
    try {
      // Only invalidate on data-modifying requests
      if (!['POST', 'PUT', 'DELETE'].includes(req.method)) {
        return next();
      }

      // Store original send to intercept successful responses
      const originalSend = res.send.bind(res);

      res.send = function(data) {
        // If successful (2xx status), invalidate cache
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const keysToInvalidate = invalidationFn ? invalidationFn(req, data) : [];
          
          if (keysToInvalidate.length > 0) {
            invalidateCacheKeys(keysToInvalidate).catch(err =>
              logger.debug('Failed to invalidate cache:', err.message)
            );
          }
        }
        return originalSend(data);
      };

      next();
    } catch (error) {
      logger.error('Cache invalidation middleware error:', error);
      next();
    }
  };
};

/**
 * Generate cache key from request
 * Can be overridden per route
 */
function generateCacheKey(req) {
  if (!req.cacheKey) {
    // Generate key from path and query parameters
    const queryString = Object.keys(req.query).length > 0 
      ? JSON.stringify(req.query)
      : '';
    return `cache:${req.path}:${queryString}`;
  }
  return req.cacheKey;
}

/**
 * Cache response data with TTL
 */
async function cacheResponse(client, cacheKey, data, ttl = 300) {
  try {
    const jsonData = JSON.stringify(data);
    await client.setEx(cacheKey, ttl, jsonData);
    logger.debug(`✓ Cached: ${cacheKey} (TTL: ${ttl}s)`);
  } catch (error) {
    logger.debug(`Failed to cache ${cacheKey}:`, error.message);
  }
}

/**
 * Invalidate cache keys
 */
async function invalidateCacheKeys(keys) {
  try {
    const client = getRedisClient();
    if (keys.length === 0) return;

    let totalDeleted = 0;

    for (const keyPattern of keys) {
      // Check if it's a pattern (contains * or ?)
      if (keyPattern.includes('*') || keyPattern.includes('?')) {
        // Find all keys matching the pattern
        const matchingKeys = await client.keys(keyPattern);
        if (matchingKeys.length > 0) {
          const deleted = await client.del(matchingKeys);
          totalDeleted += deleted;
          logger.debug(`✓ Invalidated ${deleted} cache keys matching: ${keyPattern}`);
        }
      } else {
        // Exact key match
        const deleted = await client.del(keyPattern);
        if (deleted > 0) {
          totalDeleted += deleted;
          logger.debug(`✓ Invalidated cache: ${keyPattern}`);
        }
      }
    }

    if (totalDeleted > 0) {
      logger.debug(`Total cache keys invalidated: ${totalDeleted}`);
    }
  } catch (error) {
    logger.debug('Failed to invalidate cache:', error.message);
  }
}

/**
 * Update cache statistics
 */
async function updateCacheStats(client, cacheKey, type) {
  try {
    const statsKey = 'cache:stats';
    
    if (type === 'hit') {
      await client.hIncrBy(statsKey, 'total_hits', 1);
      await client.hSet(statsKey, 'last_hit', new Date().toISOString());
    } else if (type === 'miss') {
      await client.hIncrBy(statsKey, 'total_misses', 1);
      await client.hSet(statsKey, 'last_miss', new Date().toISOString());
    }

    // Set TTL on stats
    await client.expire(statsKey, 86400);
  } catch (error) {
    logger.debug('Failed to update cache stats:', error.message);
  }
}

/**
 * Get cache statistics
 */
async function getCacheStats() {
  try {
    const client = getRedisClient();
    const stats = await client.hGetAll('cache:stats');
    return stats || {};
  } catch (error) {
    logger.error('Failed to get cache stats:', error);
    return {};
  }
}

module.exports = {
  cacheLayerMiddleware,
  cacheInvalidationMiddleware,
  getCacheStats,
  invalidateCacheKeys,
  cacheResponse
};