-- ─────────────────── Cache Invalidation Lua Script ──────────────
-- KEYS[1] = cache key to invalidate
-- KEYS[2] = cache stats key
-- ARGV[1] = timestamp

-- Returns: 1 if invalidated, 0 if not found

local key = KEYS[1]
local stats_key = KEYS[2]
local timestamp = ARGV[1]

-- Delete the cache key
local result = redis.call('DEL', key)

-- Update stats
if result > 0 then
  redis.call('HSET', stats_key, 'last_invalidation', timestamp)
  redis.call('HINCRBY', stats_key, 'invalidations', 1)
end

-- Set expiry on stats
redis.call('EXPIRE', stats_key, 86400)

return result
