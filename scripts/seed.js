const dotenv = require('dotenv');
const { initPostgres, query } = require('../src/services/postgres');
const { initRedisClient, getRedisClient } = require('../src/services/redis');
const { hashPassword } = require('../src/services/auth');
const logger = require('../src/utils/logger');

dotenv.config();

const seedDatabase = async () => {
  try {
    logger.info('Seeding database...');
    await initPostgres();
    await initRedisClient();

    const defaultUserPassword = process.env.DEFAULT_USER_PASSWORD || 'Legacy@123';
    const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@123';
    const defaultUserHash = hashPassword(defaultUserPassword);
    const defaultAdminHash = hashPassword(defaultAdminPassword);

    await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT');
    await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(120)');
    await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user'");
    await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP');

    // Create / update dedicated admin account
    await query(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, 'admin')
       ON CONFLICT (username)
       DO UPDATE SET
         email = EXCLUDED.email,
         password_hash = EXCLUDED.password_hash,
         full_name = EXCLUDED.full_name,
         role = 'admin',
         updated_at = CURRENT_TIMESTAMP`,
      ['admin_master', 'admin_master@voting.local', defaultAdminHash, 'System Administrator']
    );

    // Create sample users
    const seedUsers = [];
    for (let i = 1; i <= 10; i++) {
      seedUsers.push({
        username: `user${i}`,
        email: `user${i}@example.com`,
        fullName: `Demo User ${i}`
      });
    }
    seedUsers.push(
      { username: 'hoa_demo', email: 'hoa_demo@example.com', fullName: 'Hoa Demo' },
      { username: 'tranvanc', email: 'tranvanc@example.com', fullName: 'Tran Van C' },
      { username: 'lethib', email: 'lethib@example.com', fullName: 'Le Thi B' },
      { username: 'nguyenvana', email: 'nguyenvana@example.com', fullName: 'Nguyen Van A' }
    );

    const users = [];
    for (const user of seedUsers) {
      const result = await query(
        `INSERT INTO users (username, email, password_hash, full_name, role) 
         VALUES ($1, $2, $3, $4, 'user')
         ON CONFLICT (username) DO UPDATE SET
           email = EXCLUDED.email,
           password_hash = EXCLUDED.password_hash,
           full_name = EXCLUDED.full_name,
           role = 'user',
           updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [user.username, user.email, defaultUserHash, user.fullName]
      );
      users.push(result.rows[0].id);
    }
    logger.info(`Created/updated ${users.length} sample users`);

    // Force all non-admin users to user role and ensure they can login.
    await query(
      `UPDATE users
       SET role = 'user',
           password_hash = COALESCE(password_hash, $1),
           updated_at = CURRENT_TIMESTAMP
       WHERE username <> 'admin_master'`,
      [defaultUserHash]
    );

    logger.info('Seeded auth data:');
    logger.info(`  - Admin account: admin_master / ${defaultAdminPassword}`);
    logger.info(`  - Default user password: ${defaultUserPassword}`);

    // Create sample items
    const items = [];
    const itemTitles = [
      'Nguyen',
      'Hoa',
      'Phong',
      'An',
    ]

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
