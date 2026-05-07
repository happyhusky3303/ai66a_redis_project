-- ─────────────────── Extensions ──────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────── Drop Tables (FK-safe reverse order) ──────────────
DROP TABLE IF EXISTS api_logs        CASCADE;
DROP TABLE IF EXISTS rate_limit_stats CASCADE;
DROP TABLE IF EXISTS votes            CASCADE;
DROP TABLE IF EXISTS cache_stats      CASCADE;
DROP TABLE IF EXISTS items            CASCADE;
DROP TABLE IF EXISTS users            CASCADE;

-- ─────────────────── Users Table ──────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────── Items Table (Items to Vote On) ──────────────
CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  score INTEGER DEFAULT 0,
  rank INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_score ON items(score DESC);
CREATE INDEX IF NOT EXISTS idx_rank ON items(rank);

-- ─────────────────── Votes Table (Transactional Record) ──────────────
CREATE TABLE IF NOT EXISTS votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  vote_value SMALLINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_user_item UNIQUE(user_id, item_id)
);

-- ─────────────────── Rate Limit Stats Table ──────────────
CREATE TABLE IF NOT EXISTS rate_limit_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  window_start TIMESTAMP NOT NULL,
  window_end TIMESTAMP NOT NULL,
  requests_allowed INTEGER NOT NULL,
  requests_blocked INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_window ON rate_limit_stats(user_id, window_start, window_end);

-- ─────────────────── Cache Stats Table ──────────────
CREATE TABLE IF NOT EXISTS cache_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key VARCHAR(255) NOT NULL,
  hits INTEGER DEFAULT 0,
  misses INTEGER DEFAULT 0,
  ttl_seconds INTEGER,
  last_hit TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cache_key ON cache_stats(cache_key);
CREATE INDEX IF NOT EXISTS idx_last_hit ON cache_stats(last_hit);

-- ─────────────────── API Logs Table ──────────────
CREATE TABLE IF NOT EXISTS api_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  endpoint VARCHAR(255) NOT NULL,
  method VARCHAR(10) NOT NULL,
  status_code INTEGER NOT NULL,
  response_time_ms INTEGER,
  rate_limited BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_id ON api_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_endpoint ON api_logs(endpoint);
CREATE INDEX IF NOT EXISTS idx_created_at ON api_logs(created_at DESC);

-- ─────────────────── Indexes for Performance ──────────────
CREATE INDEX IF NOT EXISTS idx_votes_user_id ON votes(user_id);
CREATE INDEX IF NOT EXISTS idx_votes_item_id ON votes(item_id);
CREATE INDEX IF NOT EXISTS idx_votes_created_at ON votes(created_at DESC);

-- ─────────────────── Partitioning for Large Tables (Optional) ──────────────
-- ALTER TABLE votes PARTITION BY RANGE (YEAR(created_at)) (
--   PARTITION p2024 VALUES LESS THAN (2025),
--   PARTITION p2025 VALUES LESS THAN (2026)
-- );
