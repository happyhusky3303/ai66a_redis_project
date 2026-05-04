const { MongoClient, ServerApiVersion } = require('mongodb');
const logger = require('../utils/logger');

let mongoClient;
let db;

const initMongoDB = async () => {
  try {
    mongoClient = new MongoClient(process.env.MONGODB_URI, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
      connectTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      retryWrites: true,
      retryReads: true
    });

    await mongoClient.connect();
    db = mongoClient.db(process.env.MONGODB_DB || 'rate_limiting_logs');

    // Send a ping to confirm a successful connection
    await db.admin().ping();
    logger.info('Connected to MongoDB');

    // Create indexes
    await createIndexes();

    return db;
  } catch (error) {
    logger.error('Failed to initialize MongoDB:', error);
    throw error;
  }
};

const createIndexes = async () => {
  try {
    const logsCollection = db.collection('request_logs');
    
    // Create indexes for common queries
    await logsCollection.createIndex({ userId: 1, timestamp: -1 });
    await logsCollection.createIndex({ endpoint: 1, timestamp: -1 });
    await logsCollection.createIndex({ status: 1 });
    await logsCollection.createIndex({ timestamp: 1 }, { expireAfterSeconds: 2592000 }); // 30 days TTL

    logger.info('MongoDB indexes created');
  } catch (error) {
    if (!error.message.includes('already exists')) {
      logger.warn('MongoDB index creation warning:', error.message);
    }
  }
};

const getDB = () => {
  if (!db) {
    throw new Error('MongoDB not initialized. Call initMongoDB() first.');
  }
  return db;
};

const logRequest = async (logData) => {
  try {
    const logsCollection = db.collection('request_logs');
    const result = await logsCollection.insertOne({
      ...logData,
      timestamp: new Date(),
      _ttl: new Date()
    });
    return result;
  } catch (error) {
    logger.error('Failed to log request to MongoDB:', error);
    // Don't throw - logging shouldn't break the app
  }
};

module.exports = {
  initMongoDB,
  getDB,
  logRequest,
  mongoClient: {
    quit: async () => {
      if (mongoClient) {
        await mongoClient.close();
      }
    }
  }
};
