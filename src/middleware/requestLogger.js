const logger = require('../utils/logger');

const requestLogger = (req, res, next) => {
  const start = Date.now();

  // Log response
  res.on('finish', () => {
    const duration = Date.now() - start;
    const log = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userId: req.userId,
      timestamp: new Date().toISOString()
    };

    if (res.statusCode >= 400) {
      logger.warn('HTTP Request', log);
    } else {
      logger.debug('HTTP Request', log);
    }
  });

  next();
};

module.exports = requestLogger;
