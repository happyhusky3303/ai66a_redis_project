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

// Import services
const { initRedisClient, redisClient } = require('./src/services/redis');
const { initPostgres, pool } = require('./src/services/postgres');
const { initMongoDB } = require('./src/services/mongodb');
const logger = require('./src/utils/logger');

// Import middleware
const errorHandler = require('./src/middleware/errorHandler');
const requestLogger = require('./src/middleware/requestLogger');
const rateLimitMiddleware = require('./src/middleware/rateLimit');

// Import routes
const apiRoutes = require('./src/routes/api');
const adminRoutes = require('./src/routes/admin');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ─────────────── Middleware ──────────────
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ limit: '10kb', extended: true }));

// Request logging
app.use(requestLogger);

// ─────────────── Static Files ──────────────
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// ─────────────── Routes ──────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    redis: redisClient.isOpen ? 'connected' : 'disconnected',
    postgres: 'connected',
    mongodb: 'connected'
  });
});

// API routes with rate limiting
app.use('/api', rateLimitMiddleware, apiRoutes);

// Admin routes (require API key)
app.use('/admin/api', adminRoutes);

// Serve admin dashboard
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin/index.html'));
});

// Serve main dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// ─────────────── WebSocket Events ──────────────
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  // Real-time rate limit updates
  socket.on('join_rate_limit_room', (userId) => {
    socket.join(`rate_limit_${userId}`);
    logger.debug(`User ${userId} joined rate limit room`);
  });

  // Real-time cache updates
  socket.on('join_cache_room', () => {
    socket.join('cache_updates');
  });

  // Real-time ranking updates
  socket.on('join_ranking_room', () => {
    socket.join('ranking_updates');
  });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// ─────────────── Error Handling ──────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

app.use(errorHandler);

// ─────────────── Graceful Shutdown ──────────────
const gracefulShutdown = async () => {
  logger.info('Initiating graceful shutdown...');

  try {
    server.close(async () => {
      logger.info('HTTP server closed');

      if (redisClient.isOpen) {
        await redisClient.quit();
        logger.info('Redis connection closed');
      }

      if (pool) {
        await pool.end();
        logger.info('PostgreSQL connection closed');
      }

      logger.info('Graceful shutdown completed');
      process.exit(0);
    });

    // Force close after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown timeout');
      process.exit(1);
    }, 30000);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// ─────────────── Initialize & Start ──────────────
const initializeApp = async () => {
  try {
    logger.info('Initializing services...');

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
      logger.info(`🚀 Server running on http://localhost:${PORT}`);
      logger.info(`📊 Admin panel at http://localhost:${PORT}/admin`);
    });

  } catch (error) {
    logger.error('Failed to initialize app:', error);
    process.exit(1);
  }
};

initializeApp();

// Export for testing
module.exports = { app, server, io };
