const fs = require('fs');
const path = require('path');
const { getRedisClient } = require('../services/redis');
const logger = require('../utils/logger');

/**
 * RedisScripts - Manages all Lua scripts for atomic operations
 * Handles rate limiting, voting, and cache invalidation
 */
class RedisScripts {
  constructor() {
    this.scripts = {};
    this.sha = {}; // Store SHA1 hashes for script caching
    this.loadScripts();
  }

  /**
   * Load all Lua scripts from disk
   */
  loadScripts() {
    const luaDir = path.join(__dirname, '../lua');
    if (!fs.existsSync(luaDir)) {
      logger.warn('Lua scripts directory not found');
      return;
    }

    const files = fs.readdirSync(luaDir).filter(f => f.endsWith('.lua'));

    files.forEach(file => {
      const scriptName = path.basename(file, '.lua');
      const scriptPath = path.join(luaDir, file);
      try {
        const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
        this.scripts[scriptName] = scriptContent;
        logger.debug(`✓ Loaded Lua script: ${scriptName}`);
      } catch (error) {
        logger.error(`Failed to load Lua script ${scriptName}:`, error.message);
      }
    });
  }

  /**
   * SLIDING WINDOW RATE LIMITING
   * O(log N) complexity using Redis Sorted Sets
   * 
   * Returns: { allowed, blocked, remaining, retryAfter }
   */
  async slidingWindowRateLimit(userId, maxRequests, windowSeconds, requestCount = 1) {
    const client = getRedisClient();
    const key = `rate_limit:${userId}`;
    const statsKey = `rate_limit_stats:${userId}`;
    const now = Date.now();

    try {
      const result = await client.eval(
        this.scripts.slidingWindowRateLimit,
        {
          keys: [key, statsKey],
          arguments: [
            now.toString(),
            windowSeconds.toString(),
            maxRequests.toString(),
            requestCount.toString()
          ]
        }
      );

      return {
        allowed: result[0],
        blocked: result[1],
        remaining: result[2],
        retryAfter: result[3],
        timestamp: now
      };
    } catch (error) {
      logger.error('Rate limit script error:', error);
      // Fail open on Redis error - allow request
      return {
        allowed: requestCount,
        blocked: 0,
        remaining: maxRequests - requestCount,
        retryAfter: 0,
        timestamp: now,
        error: true
      };
    }
  }

  /**
   * ATOMIC VOTING SYSTEM
   * Prevents duplicate votes and race conditions
   * All operations are atomic - guaranteed consistency
   * 
   * Returns: { newScore, rank, isNewVote, oldVoteValue }
   */
  async vote(userId, itemId, voteValue = 1) {
    const client = getRedisClient();
    const votesKey = `votes:${itemId}`;
    const userVotesKey = `user_votes:${userId}`;
    const leaderboardKey = 'leaderboard';
    const voteHistoryKey = `vote_history:${itemId}`;
    const now = Date.now();

    try {
      const result = await client.eval(
        this.scripts.voting,
        {
          keys: [votesKey, userVotesKey, leaderboardKey, voteHistoryKey],
          arguments: [itemId, userId, voteValue.toString(), now.toString()]
        }
      );

      return {
        newScore: result[0],
        rank: result[1],
        isNewVote: result[2],
        oldVoteValue: result[3],
        timestamp: now
      };
    } catch (error) {
      logger.error('Voting script error:', error);
      throw error;
    }
  }

  /**
   * CACHE INVALIDATION
   * Atomically invalidate cache entries and update statistics
   * Supports pattern-based bulk invalidation
   * 
   * Returns: { totalDeleted, keysAffected }
   */
  async invalidateCache(cacheKeys, operationType = 'manual') {
    const client = getRedisClient();
    const now = Date.now();
    const ttl = 86400; // 24 hours

    // Normalize to array
    if (!Array.isArray(cacheKeys)) {
      cacheKeys = [cacheKeys];
    }

    try {
      const result = await client.eval(
        this.scripts.cacheInvalidation,
        {
          keys: cacheKeys,
          arguments: [now.toString(), operationType, ttl.toString()]
        }
      );

      return {
        totalDeleted: result[0],
        keysAffected: result[1],
        timestamp: now
      };
    } catch (error) {
      logger.error('Cache invalidation script error:', error);
      // Fail open - invalidate manually
      for (const key of cacheKeys) {
        try {
          await client.del(key);
        } catch (e) {
          logger.warn(`Failed to invalidate cache key ${key}:`, e.message);
        }
      }
      return {
        totalDeleted: cacheKeys.length,
        keysAffected: cacheKeys.length,
        timestamp: now,
        error: true
      };
    }
  }

  /**
   * Get all loaded scripts
   */
  getScripts() {
    return this.scripts;
  }

  /**
   * Check if a script is loaded
   */
  hasScript(scriptName) {
    return !!this.scripts[scriptName];
  }
}

module.exports = new RedisScripts();
