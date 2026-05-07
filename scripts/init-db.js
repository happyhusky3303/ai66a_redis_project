const dotenv = require('dotenv');
const { initPostgres, query } = require('../src/services/postgres');
const { initMongoDB } = require('../src/services/mongodb');
const { initRedisClient, getRedisClient } = require('../src/services/redis');
const logger = require('../src/utils/logger');

dotenv.config();

const initializeDatabase = async () => {
  try {
    logger.info('Initializing databases...');

    // Initialize Redis
    await initRedisClient();
    logger.info('✓ Redis initialized');

    // Initialize PostgreSQL
    await initPostgres();
    logger.info('✓ PostgreSQL initialized');

    // Initialize MongoDB
    await initMongoDB();
    logger.info('✓ MongoDB initialized');

    logger.info('All databases initialized successfully!');
    process.exit(0);
  } catch (error) {
    logger.error('Database initialization failed:', error);
    process.exit(1);
  }
};

initializeDatabase();
