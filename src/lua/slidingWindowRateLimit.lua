-- ═════════════════════════════════════════════════════════════════════════
-- SLIDING WINDOW RATE LIMITER (Atomic Operation)
-- ═════════════════════════════════════════════════════════════════════════
--
-- Purpose: Implement sliding window rate limiting with O(log N) complexity
-- using Redis Sorted Set, guaranteeing atomic operations
--
-- KEYS[1] = rate_limit:{userId}         (Sorted Set - window timestamps)
-- KEYS[2] = rate_limit_stats:{userId}   (Hash - statistics)
--
-- ARGV[1] = now                         (Current timestamp in ms)
-- ARGV[2] = window_seconds              (Time window in seconds)
-- ARGV[3] = max_requests                (Max requests allowed in window)
-- ARGV[4] = request_count               (Number of requests to process)
--
-- RETURNS: [allowed, blocked, remaining, retry_after]
-- ═════════════════════════════════════════════════════════════════════════

local rate_key = KEYS[1]
local stats_key = KEYS[2]
local now = tonumber(ARGV[1])
local window_seconds = tonumber(ARGV[2])
local max_requests = tonumber(ARGV[3])
local request_count = tonumber(ARGV[4])

-- Convert window to milliseconds
local window_ms = window_seconds * 1000

-- Step 1: Remove all entries older than the current window
-- This maintains the sliding window by deleting expired requests
local cutoff_time = now - window_ms
redis.call('ZREMRANGEBYSCORE', rate_key, '-inf', cutoff_time)

-- Step 2: Count current requests in the sliding window
local current_requests = redis.call('ZCARD', rate_key)

-- Step 3: Determine how many requests can be allowed
local allowed = 0
local blocked = 0
local remaining = 0
local retry_after = 0

if current_requests < max_requests then
  -- Calculate how many requests we can allow
  local available_slots = max_requests - current_requests
  allowed = math.min(request_count, available_slots)
  blocked = request_count - allowed
  remaining = available_slots - allowed
  
  -- Add allowed requests to the sorted set (timestamp as member)
  -- This atomically records when this request was made
  for i = 1, allowed do
    local request_id = now .. '-' .. math.random(1, 1000000)
    redis.call('ZADD', rate_key, now, request_id)
  end
else
  -- All requests exceed the limit
  blocked = request_count
  remaining = 0
  
  -- Calculate when the oldest request expires
  local oldest_score = redis.call('ZRANGE', rate_key, 0, 0, 'WITHSCORES')
  if oldest_score and #oldest_score >= 2 then
    local oldest_timestamp = tonumber(oldest_score[2])
    local reset_time = oldest_timestamp + window_ms
    retry_after = math.ceil(math.max(reset_time - now, 0) / 1000)
  else
    retry_after = window_seconds
  end
end

-- Step 4: Update statistics hash
if allowed > 0 then
  redis.call('HINCRBY', stats_key, 'allowed', allowed)
end
if blocked > 0 then
  redis.call('HINCRBY', stats_key, 'blocked', blocked)
end
redis.call('HSET', stats_key, 'last_check', now)

-- Step 5: Set TTL to prevent memory leaks
redis.call('EXPIRE', rate_key, window_seconds + 1)
redis.call('EXPIRE', stats_key, window_seconds * 2)

-- Step 6: Calculate time until window resets (for Retry-After header)
if retry_after == 0 and current_requests > 0 then
  local oldest = redis.call('ZRANGE', rate_key, 0, 0, 'WITHSCORES')
  if oldest and #oldest >= 2 then
    local oldest_ts = tonumber(oldest[2])
    retry_after = math.ceil(math.max((oldest_ts + window_ms - now) / 1000, 0))
  end
end

-- Return results as array
return { allowed, blocked, remaining, retry_after }
