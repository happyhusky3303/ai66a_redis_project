-- ─────────────────── Sliding Window Rate Limit Lua Script ──────────────
-- KEYS[1] = rate limit key (e.g., "rate_limit:user:123")
-- KEYS[2] = stats key (e.g., "rate_limit_stats:user:123")
-- ARGV[1] = current timestamp
-- ARGV[2] = window duration in seconds
-- ARGV[3] = max requests in window
-- ARGV[4] = number of requests to allow (partial accept support)

-- Returns: [allowed_count, blocked_count, ttl]

local key = KEYS[1]
local stats_key = KEYS[2]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max_requests = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])
local window_ms = window * 1000

-- Clean up old entries (older than window)
local min_time = now - window_ms
redis.call('ZREMRANGEBYSCORE', key, 0, min_time)

-- Count current requests in window
local current_count = redis.call('ZCARD', key)

-- Calculate how many requests can be allowed
local allowed = 0
local blocked = 0

if current_count < max_requests then
  -- We can allow some requests
  allowed = math.min(requested, max_requests - current_count)
  blocked = requested - allowed
  
  -- Add allowed requests to sorted set
  for i = 1, allowed do
    redis.call('ZADD', key, now + (i - 1), now .. ':' .. i .. ':' .. (current_count + i))
  end
else
  -- All requests are blocked
  allowed = 0
  blocked = requested
end

-- Update stats
if allowed > 0 or blocked > 0 then
  redis.call('HINCRBY', stats_key, 'allowed', allowed)
  redis.call('HINCRBY', stats_key, 'blocked', blocked)
  redis.call('HSET', stats_key, 'last_timestamp', now)
end

-- Set expiry on the key
redis.call('EXPIRE', key, window)
redis.call('EXPIRE', stats_key, window * 2)

-- Estimate reset TTL in seconds from oldest request
local ttl = window
if redis.call('ZCARD', key) > 0 then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  if oldest and oldest[2] then
    local reset_ms = (tonumber(oldest[2]) + window_ms) - now
    ttl = math.ceil(math.max(reset_ms, 0) / 1000)
  end
end

-- Return results
return { allowed, blocked, ttl }
