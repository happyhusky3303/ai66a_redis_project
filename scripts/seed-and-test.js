require('dotenv').config();
const { initPostgres, query } = require('../src/services/postgres');
const { initRedisClient } = require('../src/services/redis');
const { hashPassword } = require('../src/services/auth');
const { verifyPassword } = require('../src/services/auth');
const logger = require('../src/utils/logger');

async function seedAndTest() {
  try {
    console.log('Initializing services...');
    await initPostgres();
    await initRedisClient();

    console.log('Seeding users...');
    const defaultUserPassword = 'Legacy@123';
    const defaultAdminPassword = 'Admin@123';
    const defaultUserHash = hashPassword(defaultUserPassword);
    const defaultAdminHash = hashPassword(defaultAdminPassword);

    // Create admin user
    await query(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, 'admin')
       ON CONFLICT (username)
       DO UPDATE SET
         email = EXCLUDED.email,
         password_hash = EXCLUDED.password_hash,
         full_name = EXCLUDED.full_name,
         role = 'admin'`,
      ['admin_master', 'admin_master@voting.local', defaultAdminHash, 'System Administrator']
    );

    // Create sample users
    for (let i = 1; i <= 3; i++) {
      await query(
        `INSERT INTO users (username, email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4, 'user')
         ON CONFLICT (username) DO UPDATE SET
           email = EXCLUDED.email,
           password_hash = EXCLUDED.password_hash,
           full_name = EXCLUDED.full_name`,
        [`user${i}`, `user${i}@example.com`, defaultUserHash, `Demo User ${i}`]
      );
    }

    console.log('Testing password verification...');

    // Test users
    const testUsers = [
      { username: 'user1', password: 'Legacy@123' },
      { username: 'user2', password: 'Legacy@123' },
      { username: 'admin_master', password: 'Admin@123' }
    ];

    for (const testUser of testUsers) {
      console.log(`\n--- Testing ${testUser.username} ---`);

      const userResult = await query(
        'SELECT id, username, password_hash FROM users WHERE username = $1',
        [testUser.username]
      );

      if (userResult.rows.length === 0) {
        console.log(`❌ User ${testUser.username} not found in database`);
        continue;
      }

      const user = userResult.rows[0];
      console.log(`User ID: ${user.id}`);
      console.log(`Username: ${user.username}`);
      console.log(`Password hash present: ${!!user.password_hash}`);

      if (!user.password_hash) {
        console.log(`❌ No password hash found for ${testUser.username}`);
        continue;
      }

      console.log(`Password hash: ${user.password_hash.substring(0, 50)}...`);

      const isValid = await verifyPassword(testUser.password, user.password_hash);
      console.log(`Password verification result: ${isValid ? '✅ SUCCESS' : '❌ FAILED'}`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

seedAndTest();