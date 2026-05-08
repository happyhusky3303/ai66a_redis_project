const { Pool } = require('pg');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

let pool;

const initPostgres = async () => {
  try {
    if (pool) {
      return pool;
    }

    pool = new Pool({
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      host: process.env.POSTGRES_HOST,
      port: process.env.POSTGRES_PORT,
      database: process.env.POSTGRES_DB,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      max: 20,
      statement_timeout: 30000
    });

    pool.on('error', (err) => {
      logger.error('PostgreSQL pool error:', err);
    });

    // Test connection
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();

    logger.info('Connected to PostgreSQL');

    // Initialize schema
    await initSchema();

    return pool;
  } catch (error) {
    logger.error('Failed to initialize PostgreSQL:', error);
    throw error;
  }
};

const initSchema = async () => {
  try {
    // Check if tables already exist
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'users'
      )
    `);
    
    if (result.rows[0].exists) {
      logger.info('Database schema already exists, skipping initialization');
      return;
    }

    const schemaPath = path.join(__dirname, '../database/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    
    await pool.query(schema);
    logger.info('Database schema initialized');
  } catch (error) {
    logger.error('Failed to initialize schema:', error);
    // Don't throw - schema might already exist
  }
};

const getPool = () => {
  if (!pool) {
    throw new Error('PostgreSQL pool not initialized. Call initPostgres() first.');
  }
  return pool;
};

const query = async (text, params = []) => {
  if (!pool) {
    throw new Error('PostgreSQL pool not initialized. Call initPostgres() first.');
  }

  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
};

module.exports = {
  initPostgres,
  getPool,
  query,
  pool: {
    end: async () => {
      if (pool) {
        await pool.end();
      }
    }
  }
};
