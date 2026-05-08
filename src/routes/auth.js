'use strict';

const express = require('express');
const Joi = require('joi');
const { query } = require('../services/postgres');
const { hashPassword, verifyPassword, createToken } = require('../services/auth');
const { requireUserAuth } = require('../middleware/userAuth');
const logger = require('../utils/logger');

const router = express.Router();

const registerSchema = Joi.object({
  username: Joi.string().trim().min(3).max(30).required(),
  email: Joi.string().trim().email().required(),
  password: Joi.string().min(8).max(72).required(),
  fullName: Joi.string().trim().min(2).max(120).allow('', null)
});

const loginSchema = Joi.object({
  identifier: Joi.string().trim().min(3).max(255).required(),
  password: Joi.string().min(8).max(72).required()
});

let schemaReady = false;

async function ensureAuthColumns() {
  if (schemaReady) return;
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT');
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(120)');
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user'");
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP');
  schemaReady = true;
}

function normalizeUserRow(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.full_name || null,
    role: row.role || 'user',
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null
  };
}

router.post('/register', async (req, res) => {
  try {
    await ensureAuthColumns();
    const payload = await registerSchema.validateAsync(req.body, { abortEarly: false });

    const username = payload.username.toLowerCase();
    const email = payload.email.toLowerCase();
    const passwordHash = hashPassword(payload.password);
    const fullName = payload.fullName ? payload.fullName.trim() : null;

    const existing = await query(
      'SELECT id FROM users WHERE username = $1 OR email = $2 LIMIT 1',
      [username, email]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Username or email already exists'
      });
    }

    const created = await query(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, 'user')
       RETURNING id, username, email, full_name, role, created_at, last_login_at`,
      [username, email, passwordHash, fullName]
    );

    const user = normalizeUserRow(created.rows[0]);
    const token = createToken(user);

    res.status(201).json({
      success: true,
      user,
      token
    });
  } catch (error) {
    logger.error('Register error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Registration failed'
    });
  }
});

router.post('/login', async (req, res) => {
  try {
    await ensureAuthColumns();
    const payload = await loginSchema.validateAsync(req.body, { abortEarly: false });
    const identifier = payload.identifier.toLowerCase();

    const result = await query(
      `SELECT id, username, email, password_hash, full_name, role, created_at, last_login_at
       FROM users
       WHERE username = $1 OR email = $1
       LIMIT 1`,
      [identifier]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    const row = result.rows[0];
    const ok = verifyPassword(payload.password, row.password_hash);
    if (!ok) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    await query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [row.id]);

    const user = normalizeUserRow({
      ...row,
      last_login_at: new Date().toISOString()
    });

    const token = createToken(user);

    res.json({
      success: true,
      user,
      token
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Login failed'
    });
  }
});

router.get('/me', requireUserAuth, async (req, res) => {
  try {
    await ensureAuthColumns();
    const result = await query(
      `SELECT id, username, email, full_name, role, created_at, last_login_at
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    return res.json({
      success: true,
      user: normalizeUserRow(result.rows[0])
    });
  } catch (error) {
    logger.error('Get current user error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get user profile'
    });
  }
});

module.exports = router;
