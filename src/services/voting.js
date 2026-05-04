const { query } = require('./postgres');
const cacheLayer = require('./cache');
const redisScripts = require('../utils/redisScripts');
const { getRedisClient } = require('./redis');
const logger = require('../utils/logger');

class VotingService {
  /**
   * Cast a vote for an item
   */
  async vote(userId, itemId, voteValue = 1) {
    try {
      // Update in Redis (real-time)
      const voteResult = await redisScripts.vote(userId, itemId, voteValue);

      // Also update in PostgreSQL (transactional)
      const pgResult = await query(
        `INSERT INTO votes (user_id, item_id, vote_value) 
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, item_id) 
         DO UPDATE SET vote_value = EXCLUDED.vote_value, updated_at = CURRENT_TIMESTAMP
         RETURNING id, vote_value`,
        [userId, itemId, voteValue]
      );

      // Invalidate caches
      await cacheLayer.invalidatePattern('cache:item:*');
      await cacheLayer.invalidatePattern('cache:ranking');

      logger.debug(`Vote cast by user ${userId} on item ${itemId}`);

      return {
        voteId: pgResult.rows[0].id,
        ...voteResult,
        synced: true
      };
    } catch (error) {
      logger.error('Vote error:', error);
      throw error;
    }
  }

  /**
   * Get item details with vote count
   */
  async getItem(itemId) {
    try {
      const cacheKey = `cache:item:${itemId}`;
      const ttl = parseInt(process.env.CACHE_TTL_ITEM) || 600;

      return await cacheLayer.getOrSet(
        cacheKey,
        async () => {
          const result = await query(
            `SELECT id, title, description, created_at, updated_at 
             FROM items WHERE id = $1`,
            [itemId]
          );

          if (result.rows.length === 0) {
            throw new Error('Item not found');
          }

          const item = result.rows[0];

          // Get vote count from Redis
          const client = getRedisClient();
          const redisVotes = await client.hGet(`votes:${itemId}`, 'total');
          item.score = parseInt(redisVotes) || 0;

          // Get rank from leaderboard
          const rank = await client.zRevRank('leaderboard', itemId);
          item.rank = rank !== null ? rank + 1 : null;

          return item;
        },
        ttl
      );
    } catch (error) {
      logger.error('GetItem error:', error);
      throw error;
    }
  }

  /**
   * Get top N items (leaderboard)
   */
  async getTopItems(limit = 10, offset = 0) {
    try {
      const cacheKey = 'cache:ranking';
      const ttl = parseInt(process.env.CACHE_TTL_RANKING) || 300;

      return await cacheLayer.getOrSet(
        cacheKey,
        async () => {
          const client = getRedisClient();

          // Get top items from leaderboard
          const topItemIds = await client.zRevRange(
            'leaderboard',
            offset,
            offset + limit - 1,
            { WITHSCORES: true }
          );

          if (topItemIds.length === 0) {
            return [];
          }

          // Get item details from PostgreSQL
          const itemIds = topItemIds.filter((_, i) => i % 2 === 0);

          if (itemIds.length === 0) {
            return [];
          }

          const placeholders = itemIds.map((_, i) => `$${i + 1}`).join(',');
          const result = await query(
            `SELECT id, title, description, created_at, updated_at 
             FROM items WHERE id IN (${placeholders})`,
            itemIds
          );

          // Map scores back
          const scoreMap = {};
          for (let i = 0; i < topItemIds.length; i += 2) {
            scoreMap[topItemIds[i]] = parseInt(topItemIds[i + 1]);
          }

          return result.rows
            .map((item, index) => ({
              ...item,
              score: scoreMap[item.id],
              rank: offset + index + 1
            }))
            .sort((a, b) => b.score - a.score);
        },
        ttl
      );
    } catch (error) {
      logger.error('GetTopItems error:', error);
      throw error;
    }
  }

  /**
   * Get user votes
   */
  async getUserVotes(userId) {
    try {
      const result = await query(
        `SELECT item_id, vote_value, created_at 
         FROM votes WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      );

      return result.rows;
    } catch (error) {
      logger.error('GetUserVotes error:', error);
      throw error;
    }
  }

  /**
   * Sync Redis voting data to PostgreSQL
   * (Run periodically to ensure consistency)
   */
  async syncVotesToPostgres() {
    try {
      const client = getRedisClient();
      const itemIds = await client.keys('votes:*');

      let syncedCount = 0;

      for (const voteKey of itemIds) {
        const itemId = voteKey.replace('votes:', '');
        const voteData = await client.hGetAll(voteKey);

        if (voteData.total) {
          // Update item score in PostgreSQL
          await query(
            `UPDATE items SET score = $1, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $2`,
            [parseInt(voteData.total), itemId]
          );

          syncedCount++;
        }
      }

      logger.info(`Synced ${syncedCount} items to PostgreSQL`);
      return syncedCount;
    } catch (error) {
      logger.error('Sync error:', error);
      throw error;
    }
  }
}

module.exports = new VotingService();
