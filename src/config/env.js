/**
 * Environment validation
 * Ensures all required environment variables are set
 */

const logger = require('../utils/logger');

const requiredEnvVars = [
  'REDIS_HOST',
  'REDIS_PORT',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'MONGODB_URI',
  'MONGODB_DB'
];

const validateEnvironment = () => {
  const missing = [];

  requiredEnvVars.forEach(variable => {
    if (!process.env[variable]) {
      missing.push(variable);
    }
  });

  if (missing.length > 0) {
    logger.error('Missing environment variables:', missing);
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }

  logger.info('✓ Environment validation passed');
};

module.exports = validateEnvironment;
