/**
 * Constants for the application
 */

const RATE_LIMIT_DEFAULTS = {
  MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || process.env.RATE_LIMIT_MAX_VOTES, 10) || 100,
  WINDOW_SECONDS: parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS, 10) || 60,
  PARTIAL_ACCEPT: process.env.RATE_LIMIT_PARTIAL_ACCEPT === 'true'
};

const CACHE_TTL = {
  RANKING: parseInt(process.env.CACHE_TTL_RANKING || process.env.CACHE_TTL_SECONDS, 10) || 300,
  ITEM: parseInt(process.env.CACHE_TTL_ITEM || process.env.CACHE_TTL_SECONDS, 10) || 600,
  USER_VOTES: parseInt(process.env.CACHE_TTL_USER_VOTES || process.env.CACHE_TTL_SECONDS, 10) || 120
};

const CACHE_KEYS = {
  RANKING: 'cache:ranking',
  ITEM: (id) => `cache:item:${id}`,
  USER_VOTES: (userId) => `cache:user_votes:${userId}`
};

const REDIS_KEYS = {
  RATE_LIMIT: (userId) => `rate_limit:${userId}`,
  RATE_LIMIT_STATS: (userId) => `rate_limit_stats:${userId}`,
  VOTES: (itemId) => `votes:${itemId}`,
  USER_VOTES: (userId) => `user_votes:${userId}`,
  LEADERBOARD: 'leaderboard',
  CACHE_STATS: (key) => `cache_stats:${key}`
};

const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500
};

const ERRORS = {
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    status: 429,
    message: 'Too many requests. Please try again later.'
  },
  INVALID_INPUT: {
    code: 'INVALID_INPUT',
    status: 400,
    message: 'Invalid input provided'
  },
  NOT_FOUND: {
    code: 'NOT_FOUND',
    status: 404,
    message: 'Resource not found'
  },
  SERVER_ERROR: {
    code: 'SERVER_ERROR',
    status: 500,
    message: 'Internal server error'
  }
};

module.exports = {
  RATE_LIMIT_DEFAULTS,
  CACHE_TTL,
  CACHE_KEYS,
  REDIS_KEYS,
  HTTP_STATUS,
  ERRORS
};
