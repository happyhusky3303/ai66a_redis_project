const redis = require('redis');
const logger = require('../utils/logger');

let redisClient;

const initRedisClient = async () => {
  try {
    redisClient = redis.createClient({
      socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT, 10) || 6379,
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            logger.error('Max Redis reconnection attempts reached');
            return new Error('Max retries reached');
          }
          return Math.min(retries * 50, 500);
        }
      },
      password: process.env.REDIS_PASSWORD || undefined,
      database: parseInt(process.env.REDIS_DB, 10) || 0
    });

    redisClient.on('error', (err) => {
      logger.error('Redis error:', err);
    });

    redisClient.on('connect', () => {
      logger.info('Connected to Redis');
    });

    await redisClient.connect();
    
    return redisClient;
  } catch (error) {
    logger.error('Failed to initialize Redis:', error);
    throw error;
  }
};

const getRedisClient = () => {
  if (!redisClient) {
    throw new Error('Redis client not initialized. Call initRedisClient() first.');
  }
  return redisClient;
};

module.exports = {
  initRedisClient,
  getRedisClient,
  redisClient: {
    get isOpen() {
      return redisClient && redisClient.isOpen;
    },
    quit: async () => {
      if (redisClient && redisClient.isOpen) {
        await redisClient.quit();
      }
    }
  }
};
