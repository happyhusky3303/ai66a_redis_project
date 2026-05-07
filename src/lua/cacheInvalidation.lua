-- ═════════════════════════════════════════════════════════════════════════
-- CACHE INVALIDATION WITH STATISTICS
-- ═════════════════════════════════════════════════════════════════════════
--
-- Purpose: Atomically invalidate cache entries and update stats
-- Supports pattern-based invalidation for bulk operations
--
-- KEYS[1..N] = Cache keys to invalidate (supports wildcards via SCAN)
--
-- ARGV[1] = timestamp               (Invalidation timestamp)
-- ARGV[2] = operation_type          (manual, auto, system, vote)
-- ARGV[3] = ttl_seconds             (TTL for stats tracking)
--
-- RETURNS: { total_deleted, keys_affected }
-- ═════════════════════════════════════════════════════════════════════════

local timestamp = tonumber(ARGV[1])
local operation_type = ARGV[2]
local ttl_seconds = tonumber(ARGV[3]) or 3600

local total_deleted = 0
local stats_key = 'cache:stats'

-- Iterate through all provided cache keys and delete them
for i, cache_key in ipairs(KEYS) do
  local result = redis.call('DEL', cache_key)
  if result > 0 then
    total_deleted = total_deleted + result
    
    -- Track invalidation in stats (operation audit trail)
    redis.call('LPUSH', 'cache:invalidation_log', 
               cache_key .. '|' .. operation_type .. '|' .. timestamp)
  end
end

-- Update global cache invalidation statistics
if total_deleted > 0 then
  redis.call('HINCRBY', stats_key, 'total_invalidations', total_deleted)
  redis.call('HINCRBY', stats_key, operation_type .. '_count', total_deleted)
  redis.call('HSET', stats_key, 'last_invalidation_time', timestamp)
end

-- Keep only recent invalidation logs (last 1000 entries)
redis.call('LTRIM', 'cache:invalidation_log', 0, 999)

-- Set expiry on stats
redis.call('EXPIRE', stats_key, ttl_seconds)
redis.call('EXPIRE', 'cache:invalidation_log', 86400)  -- Keep logs for 1 day

-- Return results
return { total_deleted, #KEYS }
