-- Initialize PostgreSQL database
-- This script runs automatically when PostgreSQL container starts

-- Create database if it doesn't exist
CREATE DATABASE IF NOT EXISTS rate_limiting_db;

-- ============================================================================
-- Create Tables in rate_limiting_db
-- ============================================================================

-- ============================================================================
-- Users Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash TEXT,
    full_name VARCHAR(120),
    role VARCHAR(20) DEFAULT 'user',
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- Items Table (Products/Candidates/Articles to vote on)
-- ============================================================================
CREATE TABLE IF NOT EXISTS items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    score INT DEFAULT 0,
    rank INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- Votes Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    vote_value INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_item_vote UNIQUE(user_id, item_id)
);

-- ============================================================================
-- API Logs Table (for tracking requests)
-- ============================================================================
CREATE TABLE IF NOT EXISTS api_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(100),
    endpoint VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    status_code INT NOT NULL,
    response_time_ms INT,
    rate_limited BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- Rate Limit Stats Table
-- ============================================================================
CREATE TABLE rate_limit_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(100) NOT NULL,
    window_start TIMESTAMP NOT NULL,
    window_end TIMESTAMP NOT NULL,
    requests_allowed INT DEFAULT 0,
    requests_blocked INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_window UNIQUE (user_id, window_start, window_end)
);

-- ============================================================================
-- Create Indexes for Performance
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_votes_user_id ON votes(user_id);
CREATE INDEX IF NOT EXISTS idx_votes_item_id ON votes(item_id);
CREATE INDEX IF NOT EXISTS idx_votes_created_at ON votes(created_at);
CREATE INDEX IF NOT EXISTS idx_items_score ON items(score);
CREATE INDEX IF NOT EXISTS idx_items_rank ON items(rank);
CREATE INDEX IF NOT EXISTS idx_api_logs_created_at ON api_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_api_logs_user_id ON api_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_rate_limit_stats_user_id ON rate_limit_stats(user_id);

-- ============================================================================
-- Sample Data (Optional)
-- ============================================================================
-- Insert / update auth-ready users (default user password: Legacy@123)
INSERT INTO users (username, email, full_name, role, password_hash) VALUES
  ('user1', 'user1@example.com', 'Demo User 1', 'user', '3a711fa7cc3ae86ab4f6797b14bd3309:7f7b597bb1f407c45eac68a379fcb930e3aed8e09dec9d2e4e30edd67f0ddf9417a2580733e8a06b9c8cfcbadebad76f4f9b82d1dab1265560a8019b9679486b'),
  ('user2', 'user2@example.com', 'Demo User 2', 'user', '3a711fa7cc3ae86ab4f6797b14bd3309:7f7b597bb1f407c45eac68a379fcb930e3aed8e09dec9d2e4e30edd67f0ddf9417a2580733e8a06b9c8cfcbadebad76f4f9b82d1dab1265560a8019b9679486b'),
  ('hoa_demo', 'hoa_demo@example.com', 'Hoa Demo', 'user', '3a711fa7cc3ae86ab4f6797b14bd3309:7f7b597bb1f407c45eac68a379fcb930e3aed8e09dec9d2e4e30edd67f0ddf9417a2580733e8a06b9c8cfcbadebad76f4f9b82d1dab1265560a8019b9679486b'),
  ('tranvanc', 'tranvanc@example.com', 'Tran Van C', 'user', '3a711fa7cc3ae86ab4f6797b14bd3309:7f7b597bb1f407c45eac68a379fcb930e3aed8e09dec9d2e4e30edd67f0ddf9417a2580733e8a06b9c8cfcbadebad76f4f9b82d1dab1265560a8019b9679486b'),
  ('lethib', 'lethib@example.com', 'Le Thi B', 'user', '3a711fa7cc3ae86ab4f6797b14bd3309:7f7b597bb1f407c45eac68a379fcb930e3aed8e09dec9d2e4e30edd67f0ddf9417a2580733e8a06b9c8cfcbadebad76f4f9b82d1dab1265560a8019b9679486b'),
  ('nguyenvana', 'nguyenvana@example.com', 'Nguyen Van A', 'user', '3a711fa7cc3ae86ab4f6797b14bd3309:7f7b597bb1f407c45eac68a379fcb930e3aed8e09dec9d2e4e30edd67f0ddf9417a2580733e8a06b9c8cfcbadebad76f4f9b82d1dab1265560a8019b9679486b')
ON CONFLICT (username) DO UPDATE
SET email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    role = 'user',
    password_hash = EXCLUDED.password_hash,
    updated_at = CURRENT_TIMESTAMP;

-- Dedicated admin account (password: Admin@123)
INSERT INTO users (username, email, full_name, role, password_hash) VALUES
  ('admin_master', 'admin_master@voting.local', 'System Administrator', 'admin', '319a99f8735de116d11470aa24bd7845:1bb34ce14e9de4418bf9aabed6f7bf92ab74b4ad171fe3e598a72c8a4cb8e58da1b0d00691d048b84b3660b8678fb36a820414c45cc652e3cf449e68fef23439')
ON CONFLICT (username) DO UPDATE
SET email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    role = 'admin',
    password_hash = EXCLUDED.password_hash,
    updated_at = CURRENT_TIMESTAMP;

-- Insert sample items if table is empty
INSERT INTO items (title, description) VALUES
  ('Project A', 'Description for project A'),
  ('Project B', 'Description for project B'),
  ('Project C', 'Description for project C')
ON CONFLICT DO NOTHING;
