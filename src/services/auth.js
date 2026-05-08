'use strict';

const crypto = require('crypto');

const TOKEN_TTL_SECONDS = parseInt(process.env.AUTH_TOKEN_TTL_SECONDS || '86400', 10);
const TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || 'change-this-auth-secret';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, passwordHash) {
  if (!passwordHash || !passwordHash.includes(':')) return false;
  const [salt, storedHash] = passwordHash.split(':');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');

  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function toBase64Url(input) {
  return Buffer.from(input).toString('base64url');
}

function fromBase64Url(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signPart(part) {
  return crypto.createHmac('sha256', TOKEN_SECRET).update(part).digest('base64url');
}

function createToken(user) {
  const payload = {
    sub: user.id,
    username: user.username,
    email: user.email,
    role: user.role || 'user',
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
  };
  const encoded = toBase64Url(JSON.stringify(payload));
  const signature = signPart(encoded);
  return `${encoded}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    throw new Error('Invalid token');
  }

  const [encoded, providedSignature] = token.split('.');
  const expectedSignature = signPart(encoded);

  const a = Buffer.from(providedSignature, 'utf8');
  const b = Buffer.from(expectedSignature, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(fromBase64Url(encoded));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  return payload;
}

function getBearerToken(req) {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) {
    return null;
  }
  return authorization.slice(7).trim();
}

module.exports = {
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  getBearerToken
};
