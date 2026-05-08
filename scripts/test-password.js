require('dotenv').config();
const { initPostgres, query } = require('../src/services/postgres');
const { verifyPassword } = require('../src/services/auth');

async function testPasswordVerification() {
  try {
    console.log('Initializing database connection...');
    await initPostgres();

    console.log('Testing password verification for pre-seeded users...');

    // Test user1 with password 'Legacy@123'
    const testUsers = [
      { username: 'user1', password: 'Legacy@123' },
      { username: 'user2', password: 'Legacy@123' },
      { username: 'admin_master', password: 'Admin@123' }
    ];

    for (const testUser of testUsers) {
      console.log(`\n--- Testing ${testUser.username} ---`);

      // Get user data from database
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

      // Test password verification
      const isValid = await verifyPassword(testUser.password, user.password_hash);
      console.log(`Password verification result: ${isValid ? '✅ SUCCESS' : '❌ FAILED'}`);
    }

  } catch (error) {
    console.error('Error during password verification test:', error);
  } finally {
    process.exit(0);
  }
}

testPasswordVerification();