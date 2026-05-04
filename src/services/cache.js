const { getRedisClient } = require('../services/redis');
const logger = require('../utils/logger');

class CacheLayer {
  constructor() {
    this.redis = null;
  }

  setRedis(client) {
    this.redis = client;
  }

  /**
   * Get or set cache with TTL
   * @param {string} key - Cache key
   * @param {function} fetchFn - Function to fetch data if cache miss
   * @param {number} ttl - Time to live in seconds
   * @returns {Promise<any>}
   */
  async getOrSet(key, fetchFn, ttl = 300) {
    try {
      const client = this.redis || getRedisClient();

      // Try to get from cache
      const cached = await client.get(key);
      if (cached) {
        await this.updateCacheStats(key, 'hit', ttl);
        return JSON.parse(cached);
      }

      // Cache miss - fetch data
      const data = await fetchFn();

      // Store in cache
      await client.setEx(key, ttl, JSON.stringify(data));
      await this.updateCacheStats(key, 'miss', ttl);

      return data;
    } catch (error) {
      logger.error(`Cache error for key ${key}:`, error);
      // Return fresh data on cache error
      return await fetchFn();
    }
  }

  /**
   * Set cache value
   */
  async set(key, value, ttl = 300) {
    try {
      const client = this.redis || getRedisClient();
      await client.setEx(key, ttl, JSON.stringify(value));
      await this.updateCacheStats(key, 'set', ttl);
      return true;
    } catch (error) {
      logger.error(`Cache set error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get cache value
   */
  async get(key) {
    try {
      const client = this.redis || getRedisClient();
      const data = await client.get(key);
      if (data) {
        await this.updateCacheStats(key, 'hit');
        return JSON.parse(data);
      }
      await this.updateCacheStats(key, 'miss');
      return null;
    } catch (error) {
      logger.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Delete cache key
   */
  async delete(key) {
    try {
      const client = this.redis || getRedisClient();
      await client.del(key);
      await this.updateCacheStats(key, 'delete');
      return true;
    } catch (error) {
      logger.error(`Cache delete error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get cache TTL
   */
  async getTTL(key) {
    try {
      const client = this.redis || getRedisClient();
      const ttl = await client.ttl(key);
      return ttl === -2 ? null : ttl; // -2 = key doesn't exist, -1 = no expiry
    } catch (error) {
      logger.error(`Cache TTL error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Update cache statistics
   */
  async updateCacheStats(key, operation, ttl = null) {
    try {
      const client = this.redis || getRedisClient();
      const statsKey = `cache_stats:${key}`;

      if (operation === 'hit') {
        await client.hIncrBy(statsKey, 'hits', 1);
      } else if (operation === 'miss') {
        await client.hIncrBy(statsKey, 'misses', 1);
      } else if (operation === 'set') {
        if (ttl) {
          await client.hSet(statsKey, 'ttl_seconds', ttl.toString());
        }
        await client.hSet(statsKey, 'last_updated', Date.now().toString());
      }

      // Update general stats
      await client.hSet(statsKey, 'last_accessed', Date.now().toString());

      // Expire stats after 24 hours
      await client.expire(statsKey, 86400);
    } catch (error) {
      logger.debug(`Cache stats update error: ${error.message}`);
      // Don't throw - stats updates shouldn't break the app
    }
  }

  /**
   * Get all cache statistics
   */
  async getAllCacheStats() {
    try {
      const client = this.redis || getRedisClient();
      const keys = await client.keys('cache_stats:*');

      const stats = [];
      for (const key of keys) {
        const stat = await client.hGetAll(key);
        stats.push({
          key: key.replace('cache_stats:', ''),
          hits: parseInt(stat.hits) || 0,
          misses: parseInt(stat.misses) || 0,
          ttl: parseInt(stat.ttl_seconds) || null,
          lastAccessed: stat.last_accessed,
          lastUpdated: stat.last_updated
        });
      }

      return stats;
    } catch (error) {
      logger.error('Failed to get cache stats:', error);
      return [];
    }
  }

  /**
   * Invalidate all caches matching pattern
   */
  async invalidatePattern(pattern) {
    try {
      const client = this.redis || getRedisClient();
      const keys = await client.keys(pattern);

      if (keys.length > 0) {
        await client.del(keys);
        logger.info(`Invalidated ${keys.length} cache keys matching ${pattern}`);
      }

      return keys.length;
    } catch (error) {
      logger.error(`Cache invalidation error for pattern ${pattern}:`, error);
      return 0;
    }
  }
}

module.exports = new CacheLayer();
