-- ═════════════════════════════════════════════════════════════════════════
-- ATOMIC VOTING SYSTEM WITH DUPLICATE PREVENTION
-- ═════════════════════════════════════════════════════════════════════════
--
-- Purpose: Implement idempotent voting with race condition prevention
-- All operations must be atomic - no partial updates allowed
--
-- KEYS[1] = votes:{itemId}               (Hash - total votes, metadata)
-- KEYS[2] = user_votes:{userId}          (Hash - user's votes on items)
-- KEYS[3] = leaderboard                  (Sorted Set - all items by score)
-- KEYS[4] = vote_history:{itemId}        (Sorted Set - voting history)
--
-- ARGV[1] = itemId                       (Item being voted on)
-- ARGV[2] = userId                       (User casting vote)
-- ARGV[3] = voteValue                    (Vote value: 1, -1, etc.)
-- ARGV[4] = timestamp                    (Unix timestamp in ms)
--
-- RETURNS: [new_score, rank, is_new_vote, old_vote_value]
-- ═════════════════════════════════════════════════════════════════════════

local votes_key = KEYS[1]         -- votes:{itemId}
local user_votes_key = KEYS[2]    -- user_votes:{userId}
local leaderboard_key = KEYS[3]   -- leaderboard
local vote_history_key = KEYS[4]  -- vote_history:{itemId}

local item_id = ARGV[1]
local user_id = ARGV[2]
local vote_value = tonumber(ARGV[3])
local timestamp = tonumber(ARGV[4])

-- Step 1: Check if user has already voted on this item
local existing_vote_str = redis.call('HGET', user_votes_key, item_id)
local existing_vote = 0
local is_new_vote = 1

if existing_vote_str then
  existing_vote = tonumber(existing_vote_str)
  is_new_vote = 0
  
  -- If voting with same value (idempotent), return current state
  if existing_vote == vote_value then
    local current_score = tonumber(redis.call('HGET', votes_key, 'total')) or 0
    local rank = tonumber(redis.call('ZREVRANK', leaderboard_key, item_id)) or 0
    return { current_score, rank + 1, 0, existing_vote }  -- 0 means no change
  end
  
  -- Otherwise, calculate score difference
  -- Remove old vote from total
  redis.call('HINCRBY', votes_key, 'total', -existing_vote)
else
  is_new_vote = 1
end

-- Step 2: Add new vote to score
-- This is atomic - either fully applies or nothing
redis.call('HINCRBY', votes_key, 'total', vote_value)

-- Step 3: Record user's vote (for duplicate detection)
redis.call('HSET', user_votes_key, item_id, vote_value)

-- Step 4: Record voting metadata
redis.call('HSET', votes_key, 'last_updated', timestamp)
redis.call('HSET', votes_key, 'updated_by', user_id)

-- Step 5: Update leaderboard (Sorted Set)
-- Score = total votes for the item
local new_score = tonumber(redis.call('HGET', votes_key, 'total')) or 0
redis.call('ZADD', leaderboard_key, new_score, item_id)

-- Step 6: Record vote in history (for audit trail)
local vote_record = user_id .. ':' .. vote_value
redis.call('ZADD', vote_history_key, timestamp, vote_record)

-- Step 7: Get current rank (1-indexed)
-- ZREVRANK returns 0-indexed, so add 1
local rank = tonumber(redis.call('ZREVRANK', leaderboard_key, item_id))
if rank then
  rank = rank + 1
else
  rank = 1
end

-- Step 8: Set expiry times to prevent memory leaks
-- Vote data lives for 7 days
redis.call('EXPIRE', votes_key, 604800)
redis.call('EXPIRE', user_votes_key, 604800)
redis.call('EXPIRE', vote_history_key, 604800)
-- Leaderboard is persistent (no expiry)

-- Return: [new_score, rank, is_new_vote, old_vote_value]
return { new_score, rank, is_new_vote, existing_vote }
