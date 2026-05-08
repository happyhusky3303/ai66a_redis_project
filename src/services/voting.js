/**
 * ═════════════════════════════════════════════════════════════════════════
 * VOTING SERVICE
 * ═════════════════════════════════════════════════════════════════════════
 * 
 * Core business logic for the voting system
 * 
 * Handles:
 * - Vote casting with Redis atomicity
 * - Real-time leaderboard updates
 * - PostgreSQL durability sync
 * - Cache invalidation
 * 
 * Architecture:
 * 1. Redis (real-time processing via Lua scripts)
 * 2. PostgreSQL (durability/ACID)
 * 3. MongoDB (asynchronous logging)
 * 4. Cache (invalidation on updates)
 * ═════════════════════════════════════════════════════════════════════════
 */

const { query } = require('./postgres');
const { cacheResponse, invalidateCacheKeys } = require('../middleware/cacheLayer');
const redisScripts = require('../utils/redisScripts');
const { getRedisClient } = require('./redis');
const { logRequest } = require('./mongodb');
const logger = require('../utils/logger');

class VotingService {
  /**
   * STEP 1: RATE LIMITING (Handled by middleware)
   * STEP 2: CACHE CHECK (Handled by middleware)
   * STEP 3: VOTING LOGIC - Cast or update a vote
   * 
   * - Atomically execute via Lua script
   * - Prevent duplicate votes
   * - Update leaderboard in real-time
   * - Sync to PostgreSQL
   * - Invalidate caches
   * - Log to MongoDB
   */
  async vote(userId, itemId, voteValue = 1) {
    const startTime = Date.now();

    try {
      // ─────────────── INPUT VALIDATION ───────────────
      if (!userId || !itemId) {
        const error = new Error('Missing required fields: userId, itemId');
        error.statusCode = 400;
        throw error;
      }

      if (!Number.isInteger(voteValue) || Math.abs(voteValue) > 10) {
        const error = new Error('Vote value must be integer between -10 and 10');
        error.statusCode = 400;
        throw error;
      }

      // ─────────────── VERIFY ITEM EXISTS ───────────────
      const itemCheck = await query(
        'SELECT id FROM items WHERE id = $1',
        [itemId]
      );

      if (itemCheck.rows.length === 0) {
        const error = new Error(`Item not found: ${itemId}`);
        error.statusCode = 404;
        throw error;
      }

      // ─────────────── EXECUTE VOTING IN REDIS (ATOMIC) ───────────────
      // Uses Lua script to ensure atomicity and prevent race conditions
      const voteResult = await redisScripts.vote(userId, itemId, voteValue);

      logger.debug(`✓ Vote processed in Redis: ${userId} -> ${itemId} (score: ${voteResult.newScore})`);

      // ─────────────── SYNC TO POSTGRESQL ───────────────
      // Uses UPSERT to handle both new votes and updates
      await this.syncVoteToPostgres(userId, itemId, voteValue);

      // ─────────────── INVALIDATE CACHES ───────────────
      // Remove cached rankings and item details
      const keysToInvalidate = [
        `cache:ranking:*`,
        `cache:item:${itemId}`,
        `cache:/api/ranking:*`
      ];
      
      invalidateCacheKeys(keysToInvalidate).catch(err =>
        logger.debug('Cache invalidation failed:', err.message)
      );

      // ─────────────── PREPARE RESPONSE ───────────────
      const responseTime = Date.now() - startTime;

      const response = {
        success: true,
        statusCode: 200,
        vote: {
          voteId: `${userId}:${itemId}`,
          userId,
          itemId,
          voteValue,
          timestamp: new Date().toISOString()
        },
        item: {
          id: itemId,
          score: voteResult.newScore,
          rank: voteResult.rank
        },
        voting: {
          isNew: voteResult.isNewVote === 1,
          previousValue: voteResult.oldVoteValue || null,
          change: voteResult.isNewVote === 1 ? voteValue : (voteValue - (voteResult.oldVoteValue || 0))
        },
        responseTime
      };

      // ─────────────── ASYNC LOGGING TO MONGODB ───────────────
      // Log vote action for analytics (non-blocking)
      logRequest({
        userId,
        endpoint: '/api/vote',
        method: 'POST',
        status: 200,
        statusCode: 200,
        action: 'vote',
        itemId,
        voteValue,
        responseTime,
        newScore: voteResult.newScore,
        rank: voteResult.rank
      }).catch(err => logger.debug('Failed to log vote to MongoDB:', err.message));

      return response;

    } catch (error) {
      logger.error('Vote error:', {
        message: error.message,
        userId,
        itemId,
        statusCode: error.statusCode || 500
      });

      // Log error to MongoDB
      logRequest({
        userId,
        endpoint: '/api/vote',
        method: 'POST',
        status: error.statusCode || 500,
        statusCode: error.statusCode || 500,
        action: 'vote',
        itemId,
        error: error.message,
        responseTime: Date.now() - startTime
      }).catch(err => logger.debug('Failed to log vote error:', err.message));

      throw error;
    }
  }

  /**
   * Get item details with vote count and rank
   * Uses Redis for real-time data + PostgreSQL for durability
   */
  async getItem(itemId) {
    try {
      const client = getRedisClient();

      // ─────────────── VERIFY ITEM EXISTS ───────────────
      const pgResult = await query(
        `SELECT id, title, description, created_at, updated_at 
         FROM items WHERE id = $1`,
        [itemId]
      );

      if (pgResult.rows.length === 0) {
        throw new Error('Item not found');
      }

      const item = pgResult.rows[0];

      // ─────────────── GET SCORE FROM REDIS ───────────────
      const scoreStr = await client.hGet(`votes:${itemId}`, 'total');
      item.score = scoreStr ? parseInt(scoreStr, 10) : 0;

      // ─────────────── GET RANK FROM LEADERBOARD ───────────────
      const rank = await client.zRevRank('leaderboard', itemId);
      item.rank = rank !== null ? rank + 1 : null;

      return item;
    } catch (error) {
      logger.error('GetItem error:', error);
      throw error;
    }
  }

  /**
   * Get top N items (leaderboard)
   * Uses Redis Sorted Set for O(log N) performance
   */
  async getTopItems(limit = 10, offset = 0) {
    limit = Math.min(parseInt(limit) || 10, 100);
    offset = Math.max(parseInt(offset) || 0, 0);

    try {
      const client = getRedisClient();

      // ─────────────── GET FROM REDIS LEADERBOARD ───────────────
      // O(log N + M) where M is the number of returned items
      const topItems = await client.zRangeWithScores(
        'leaderboard',
        offset,
        offset + limit - 1,
        { REV: true }  // Reverse order (highest first)
      );

      if (topItems.length === 0) {
        return this.getTopItemsFromPostgres(limit, offset);
      }

      // ─────────────── FETCH ITEM DETAILS FROM POSTGRESQL ───────────────
      const itemIds = topItems.map(entry => entry.value);
      const placeholders = itemIds.map((_, i) => `$${i + 1}`).join(',');
      
      const pgResult = await query(
        `SELECT id, title, description, created_at, updated_at 
         FROM items WHERE id IN (${placeholders})`,
        itemIds
      );

      // ─────────────── MERGE RESULTS ───────────────
      const itemMap = new Map(pgResult.rows.map(item => [item.id, item]));

      const results = topItems
        .map((entry, index) => {
          const item = itemMap.get(entry.value);
          if (!item) return null;

          return {
            ...item,
            score: parseInt(entry.score, 10),
            rank: offset + index + 1
          };
        })
        .filter(Boolean);

      return results;
    } catch (error) {
      logger.warn(`GetTopItems fallback to PostgreSQL: ${error.message}`);
      return this.getTopItemsFromPostgres(limit, offset);
    }
  }

  async getTopItemsFromPostgres(limit = 10, offset = 0) {
    const pgResult = await query(
      `SELECT id, title, description, score, created_at, updated_at
       FROM items
       ORDER BY score DESC, created_at ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return pgResult.rows.map((item, index) => ({
      ...item,
      score: parseInt(item.score || 0, 10),
      rank: offset + index + 1
    }));
  }

  /**
   * Get user votes
   * Retrieve all votes cast by a specific user
   */
  async getUserVotes(userId) {
    try {
      const result = await query(
        `SELECT id, item_id, vote_value, created_at, updated_at
         FROM votes 
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [userId]
      );

      return result.rows;
    } catch (error) {
      logger.error('GetUserVotes error:', error);
      throw error;
    }
  }

  /**
   * INTERNAL: Sync vote to PostgreSQL for durability
   * Uses UPSERT (INSERT ON CONFLICT) for idempotency
   */
  async syncVoteToPostgres(userId, itemId, voteValue) {
    try {
      const result = await query(
        `INSERT INTO votes (user_id, item_id, vote_value) 
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, item_id) 
         DO UPDATE SET 
           vote_value = EXCLUDED.vote_value, 
           updated_at = CURRENT_TIMESTAMP
         RETURNING id, vote_value`,
        [userId, itemId, voteValue]
      );

      logger.debug(`✓ Vote synced to PostgreSQL: ${result.rows[0].id}`);
      return result.rows[0];
    } catch (error) {
      logger.error('PostgreSQL sync error:', error);
      throw error;
    }
  }

  /**
   * Batch sync: Periodically sync all Redis votes to PostgreSQL
   * Run this as a scheduled background job to ensure consistency
   * Should run every 5-10 minutes
   */
  async syncAllVotesToPostgres() {
    try {
      const client = getRedisClient();
      const itemKeys = await client.keys('votes:*');

      let syncedCount = 0;

      for (const voteKey of itemKeys) {
        const itemId = voteKey.replace('votes:', '');
        const voteData = await client.hGetAll(voteKey);

        if (voteData.total) {
          const score = parseInt(voteData.total, 10);
          
          // Update item score in PostgreSQL
          await query(
            `UPDATE items SET score = $1, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $2`,
            [score, itemId]
          );

          syncedCount++;
        }
      }

      logger.info(`✓ Synced ${syncedCount} items to PostgreSQL`);
      return syncedCount;
    } catch (error) {
      logger.error('Batch sync error:', error);
      throw error;
    }
  }

  /**
   * Get voting statistics
   * Returns summary of voting activity
   */
  async getVotingStats() {
    try {
      const client = getRedisClient();

      const leaderboardSize = await client.zCard('leaderboard');
      const totalScore = await client.eval(
        `
        local sum = 0
        local items = redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
        for i = 2, #items, 2 do
          sum = sum + tonumber(items[i])
        end
        return sum
        `,
        { keys: ['leaderboard'] }
      );

      return {
        totalItems: leaderboardSize,
        totalScore: parseInt(totalScore || 0, 10),
        averageScore: leaderboardSize > 0 ? Math.round((totalScore || 0) / leaderboardSize) : 0
      };
    } catch (error) {
      logger.error('GetVotingStats error:', error);
      return {
        totalItems: 0,
        totalScore: 0,
        averageScore: 0
      };
    }
  }
}

module.exports = new VotingService();
