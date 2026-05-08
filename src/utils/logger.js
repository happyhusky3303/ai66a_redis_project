const winston = require('winston');
const path = require('path');
<<<<<<< HEAD

const logsDir = path.join(__dirname, '../../logs');

=======
const fs = require('fs');

// Resolve logs directory relative to project root (3 levels up from src/utils/)
const logsDir = path.join(__dirname, '../../logs');

// Ensure logs directory exists before creating transports
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

>>>>>>> e6b38f13138f0f87283f9d669f1d0529c0185580
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.printf(({ level, message, timestamp, ...meta }) => {
      const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
      return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaStr}`;
    })
  ),
  defaultMeta: { service: 'rate-limiting-api' },
  transports: [
    // Console output
    new winston.transports.Console(),

    // File outputs
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error'
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log')
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'debug.log'),
      level: 'debug'
    })
  ]
});

<<<<<<< HEAD
// Ensure logs directory exists
const fs = require('fs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

=======
>>>>>>> e6b38f13138f0f87283f9d669f1d0529c0185580
module.exports = logger;
