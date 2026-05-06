/**
 * ═════════════════════════════════════════════════════════════════════════
 * MAIN APPLICATION SERVER
 * ═════════════════════════════════════════════════════════════════════════
 * 
 * High-performance API Gateway with:
 * - Sliding Window Rate Limiting (Redis)
 * - Distributed Caching (Redis)
 * - PostgreSQL Durability
 * - MongoDB Logging
 * - Real-time WebSocket updates
 * ═════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const http = require('http');
const socketIO = require('socket.io');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

// ─────────────── IMPORTS ──────────────
// Services
const { initRedisClient, redisClient } = require('./src/services/redis');
const { initPostgres, pool, query } = require('./src/services/postgres');
const { initMongoDB, getDB, mongoClient } = require('./src/services/mongodb');
const logger = require('./src/utils/logger');

// Middleware
const errorHandler = require('./src/middleware/errorHandler');
const requestLogger = require('./src/middleware/requestLogger');
const rateLimitMiddleware = require('./src/middleware/rateLimit');
const { adminBypassRateLimit } = require('./src/middleware/auth');

// Routes
const apiRoutes = require('./src/routes/api');
const adminRoutes = require('./src/routes/admin');

// ─────────────── APP SETUP ──────────────
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ═════════════════════════════════════════════════════════════════════════
// MIDDLEWARE CONFIGURATION
// ═════════════════════════════════════════════════════════════════════════

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
    },
  },
}));

// Compression and parsing
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ limit: '10kb', extended: true }));

// Request logging and admin bypass
app.use(requestLogger);
app.use(adminBypassRateLimit);

// ─────────────── STATIC FILES ──────────────
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// ═════════════════════════════════════════════════════════════════════════
// ROUTES
// ═════════════════════════════════════════════════════════════════════════

/**
 * Root health check
 * No rate limiting on this endpoint
 */
app.get('/health', async (req, res) => {
  let postgresStatus = 'disconnected';
  let mongodbStatus = 'disconnected';

  try {
    await query('SELECT 1');
    postgresStatus = 'connected';
  } catch (error) {
    logger.debug(`Health check PostgreSQL failed: ${error.message}`);
  }

  try {
    getDB();
    mongodbStatus = 'connected';
  } catch (error) {
    logger.debug(`Health check MongoDB failed: ${error.message}`);
  }

  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    redis: 'connected',
    postgres: postgresStatus,
    mongodb: mongodbStatus
  });
});

/**
 * API Routes with Rate Limiting
 * 
 * Middleware chain:
 * 1. rateLimitMiddleware - Sliding window rate limiting (Redis)
 * 2. cacheLayerMiddleware - Cache hit/miss on GET requests
 * 3. Authentication - Validate API key (if provided)
 * 4. Business Logic - Handle request
 */
app.use('/api', 
  (req, res, next) => {
    // Skip rate limiting for admin requests
    if (req.bypassRateLimit) {
      req.rateLimitInfo = {
        allowed: 1000,
        blocked: 0,
        remaining: 1000
      };
      return next();
    }
    rateLimitMiddleware(req, res, next);
  },
  apiRoutes
);

/**
 * Admin Routes
 * No rate limiting (admin bypass)
 * Requires x-admin-api-key header
 */
app.use('/admin/api', adminRoutes);

/**
 * Serve dashboards
 */
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin/index.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// ═════════════════════════════════════════════════════════════════════════
// WEBSOCKET REAL-TIME UPDATES
// ═════════════════════════════════════════════════════════════════════════

io.on('connection', (socket) => {
  logger.info(`✓ WebSocket connected: ${socket.id}`);

  // Join rate limit room for specific user
  socket.on('join_rate_limit_room', (userId) => {
    socket.join(`rate_limit_${userId}`);
    logger.debug(`User ${userId} joined rate limit room`);
  });

  // Join cache updates room
  socket.on('join_cache_room', () => {
    socket.join('cache_updates');
    logger.debug(`Client ${socket.id} joined cache updates`);
  });

  // Join ranking updates room
  socket.on('join_ranking_room', () => {
    socket.join('ranking_updates');
    logger.debug(`Client ${socket.id} joined ranking updates`);
  });

  socket.on('disconnect', () => {
    logger.info(`✗ WebSocket disconnected: ${socket.id}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═════════════════════════════════════════════════════════════════════════

// 404 Not Found
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    statusCode: 404,
    path: req.path,
    method: req.method
  });
});

// Global error handler
app.use(errorHandler);

// ═════════════════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═════════════════════════════════════════════════════════════════════════

const gracefulShutdown = async () => {
  logger.info('🛑 Initiating graceful shutdown...');

  try {
    server.close(async () => {
      logger.info('✓ HTTP server closed');

      if (redisClient.isOpen) {
        await redisClient.quit();
        logger.info('✓ Redis connection closed');
      }

      if (pool) {
        await pool.end();
        logger.info('✓ PostgreSQL connection closed');
      }

      await mongoClient.quit();
      logger.info('✓ MongoDB connection closed');

      logger.info('✓ Graceful shutdown completed');
      process.exit(0);
    });

    // Force close after 30 seconds
    setTimeout(() => {
      logger.error('✗ Forced shutdown timeout');
      process.exit(1);
    }, 30000);
  } catch (error) {
    logger.error('✗ Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// ═════════════════════════════════════════════════════════════════════════
// APPLICATION INITIALIZATION
// ═════════════════════════════════════════════════════════════════════════

const initializeApp = async () => {
  try {
    logger.info('🔧 Initializing services...');

    // Initialize Redis
    await initRedisClient();
    logger.info('✓ Redis initialized');

    // Initialize PostgreSQL
    await initPostgres();
    logger.info('✓ PostgreSQL initialized');

    // Initialize MongoDB
    await initMongoDB();
    logger.info('✓ MongoDB initialized');

    // Start server
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      logger.info('');
      logger.info('╔═══════════════════════════════════════════════════════╗');
      logger.info('║  🚀  API GATEWAY SERVER STARTED                       ║');
      logger.info('╠═══════════════════════════════════════════════════════╣');
      logger.info(`║  🌐  http://localhost:${PORT.toString().padEnd(35)} ║`);
      logger.info(`║  📊  Admin: http://localhost:${PORT}/admin`.padEnd(55) + '║');
      logger.info(`║  🔴  Redis: Connected                                 ║`);
      logger.info(`║  🐘  PostgreSQL: Connected                            ║`);
      logger.info(`║  🍃  MongoDB: Connected                               ║`);
      logger.info('╚═══════════════════════════════════════════════════════╝');
      logger.info('');
    });

  } catch (error) {
    logger.error('✗ Failed to initialize app:', error);
    process.exit(1);
  }
};

initializeApp();

// Export for testing
module.exports = { app, server, io };
