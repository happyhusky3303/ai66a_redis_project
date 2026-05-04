const fs = require('fs');
const path = require('path');
const { getRedisClient } = require('../services/redis');
const logger = require('../utils/logger');

class RedisScripts {
  constructor() {
    this.scripts = {};
    this.loadScripts();
  }

  loadScripts() {
    const luaDir = path.join(__dirname, '../lua');
    const files = fs.readdirSync(luaDir).filter(f => f.endsWith('.lua'));

    files.forEach(file => {
      const scriptName = path.basename(file, '.lua');
      const scriptPath = path.join(luaDir, file);
      const scriptContent = fs.readFileSync(scriptPath, 'utf-8');

      this.scripts[scriptName] = scriptContent;
      logger.debug(`Loaded Lua script: ${scriptName}`);
    });
  }

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
          arguments: [now.toString(), windowSeconds.toString(), maxRequests.toString(), requestCount.toString()]
        }
      );

      return {
        allowed: result[0],
        blocked: result[1],
        ttl: result[2],
        timestamp: now
      };
    } catch (error) {
      logger.error('Error executing slidingWindowRateLimit script:', error);
      throw error;
    }
  }

  async vote(userId, itemId, voteValue = 1) {
    const client = getRedisClient();
    const votesKey = `votes:${itemId}`;
    const userKey = `user_votes:${userId}`;
    const leaderboardKey = 'leaderboard';
    const now = Date.now();

    try {
      const result = await client.eval(
        this.scripts.voting,
        {
          keys: [votesKey, userKey, leaderboardKey],
          arguments: [itemId, userId, voteValue.toString(), now.toString()]
        }
      );

      return {
        newScore: result[0],
        isNewVote: result[1],
        rank: result[2],
        timestamp: now
      };
    } catch (error) {
      logger.error('Error executing voting script:', error);
      throw error;
    }
  }

  async invalidateCache(cacheKey) {
    const client = getRedisClient();
    const statsKey = `cache_stats:${cacheKey}`;
    const now = Date.now();

    try {
      const result = await client.eval(
        this.scripts.cacheInvalidation,
        {
          keys: [cacheKey, statsKey],
          arguments: [now.toString()]
        }
      );

      return {
        invalidated: result === 1,
        timestamp: now
      };
    } catch (error) {
      logger.error('Error executing cacheInvalidation script:', error);
      throw error;
    }
  }
}

module.exports = new RedisScripts();
