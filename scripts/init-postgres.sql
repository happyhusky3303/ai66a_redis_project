-- Initialize PostgreSQL database
-- This script runs automatically when PostgreSQL container starts

-- Ensure the database exists (if not already created by POSTGRES_DB env)
CREATE DATABASE IF NOT EXISTS rate_limiting_db;

-- Use the database
\c rate_limiting_db;

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE rate_limiting_db TO postgres;
