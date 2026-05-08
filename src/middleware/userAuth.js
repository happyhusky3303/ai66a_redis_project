'use strict';

const { verifyToken, getBearerToken } = require('../services/auth');

function requireUserAuth(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const payload = verifyToken(token);
    req.user = {
      id: payload.sub,
      username: payload.username,
      email: payload.email,
      role: payload.role || 'user'
    };
    return next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: error.message || 'Invalid token'
    });
  }
}

module.exports = {
  requireUserAuth
};
