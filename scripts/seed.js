const dotenv = require('dotenv');
const { initPostgres, query } = require('../src/services/postgres');
const { initRedisClient, getRedisClient } = require('../src/services/redis');
const logger = require('../src/utils/logger');

dotenv.config();

const seedDatabase = async () => {
  try {
    logger.info('Seeding database...');
    await initPostgres();
    await initRedisClient();

    // Create sample users
    const users = [];
    for (let i = 1; i <= 10; i++) {
      const result = await query(
        `INSERT INTO users (username, email) 
         VALUES ($1, $2)
         ON CONFLICT (username) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [`user${i}`, `user${i}@example.com`]
      );
      users.push(result.rows[0].id);
    }
    logger.info(`Created ${users.length} sample users`);

    // Create sample items
    const items = [];
    const itemTitles = [
      'Best Backend Framework',
      'Fastest Database',
      'Most Popular Language',
      'Best API Gateway',
      'Top Cache Solution',
      'Best Message Queue',
      'Most Reliable Storage',
      'Best Monitoring Tool',
      'Top Load Balancer',
      'Best Testing Framework'
    ];

    for (const title of itemTitles) {
      const existingItem = await query(
        `SELECT id FROM items WHERE title = $1 LIMIT 1`,
        [title]
      );

      if (existingItem.rows.length > 0) {
        items.push(existingItem.rows[0].id);
        continue;
      }

      const result = await query(
        `INSERT INTO items (title, description) 
         VALUES ($1, $2)
         RETURNING id`,
        [title, `Vote for ${title} as the best in class`]
      );
      items.push(result.rows[0].id);
    }
    logger.info(`Created ${items.length} sample items`);

    // Create sample votes
    const redis = getRedisClient();
    let voteCount = 0;

    for (let i = 0; i < users.length; i++) {
      for (let j = 0; j < Math.floor(Math.random() * 5) + 1; j++) {
        const userId = users[i];
        const itemId = items[Math.floor(Math.random() * items.length)];
        const voteValue = 1;

        await query(
          `INSERT INTO votes (user_id, item_id, vote_value)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, item_id) DO UPDATE SET vote_value = EXCLUDED.vote_value
           RETURNING id`,
          [userId, itemId, voteValue]
        );

        // Update Redis leaderboard
        const votesKey = `votes:${itemId}`;
        await redis.hIncrBy(votesKey, 'total', voteValue);
        const currentTotalRaw = await redis.hGet(votesKey, 'total');
        const currentTotal = Number.parseInt(currentTotalRaw || '0', 10);
        await redis.zAdd('leaderboard', [{
          score: Number.isFinite(currentTotal) ? currentTotal : 0,
          value: String(itemId)
        }]);

        voteCount++;
      }
    }
    logger.info(`Created ${voteCount} sample votes`);

    // Sync to leaderboard
    const leaderboardData = {};
    for (const itemId of items) {
      const votesKey = `votes:${itemId}`;
      const totalVotes = await redis.hGet(votesKey, 'total');
      leaderboardData[itemId] = parseInt(totalVotes) || 0;
    }

    // Update PostgreSQL item scores
    for (const [itemId, score] of Object.entries(leaderboardData)) {
      await query(
        `UPDATE items SET score = $1 WHERE id = $2`,
        [score, itemId]
      );
    }

    logger.info('✓ Database seeding completed successfully!');
    process.exit(0);
  } catch (error) {
    logger.error('Database seeding failed:', error);
    process.exit(1);
  }
};

seedDatabase();
