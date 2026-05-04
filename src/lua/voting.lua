-- ─────────────────── Voting with Score Update Lua Script ──────────────
-- KEYS[1] = votes count key (e.g., "votes:item:123")
-- KEYS[2] = user votes key (e.g., "user_votes:user:456")
-- KEYS[3] = leaderboard sorted set (leaderboard)
-- ARGV[1] = item_id
-- ARGV[2] = user_id
-- ARGV[3] = vote_value
-- ARGV[4] = timestamp

-- Returns: [new_score, is_new_vote, current_rank]

local votes_key = KEYS[1]
local user_key = KEYS[2]
local leaderboard_key = KEYS[3]
local item_id = ARGV[1]
local user_id = ARGV[2]
local vote_value = tonumber(ARGV[3])
local timestamp = ARGV[4]

-- Check if user already voted
local existing_vote = redis.call('HGET', user_key, item_id)

-- If already voted, this is an update/duplicate
local is_new_vote = 1
if existing_vote then
  is_new_vote = 0
  -- Subtract previous vote
  redis.call('HINCRBY', votes_key, 'total', -tonumber(existing_vote))
else
  -- New vote
  redis.call('SADD', user_key, item_id)
end

-- Update/set vote
redis.call('HSET', user_key, item_id, vote_value)

-- Increment score
redis.call('HINCRBY', votes_key, 'total', vote_value)
redis.call('HSET', votes_key, 'last_updated', timestamp)

-- Get new score
local new_score = tonumber(redis.call('HGET', votes_key, 'total')) or 0

-- Update leaderboard (sorted set)
redis.call('ZADD', leaderboard_key, new_score, item_id)

-- Get current rank (1-indexed)
local rank = redis.call('ZREVRANK', leaderboard_key, item_id) or 0
rank = rank + 1

-- Set expiry (24 hours)
redis.call('EXPIRE', votes_key, 86400)
redis.call('EXPIRE', user_key, 86400)

-- Return results
return { new_score, is_new_vote, rank }
