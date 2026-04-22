"""
redis_client.py
Manages the Redis async connection pool and exposes the Lua-script-based
rate-limiter used in Step 1 of the voting flow.

Rate-limiting strategy
──────────────────────
We use a **sliding-window counter** implemented entirely in Lua so the
check-and-increment is atomic.

Lua script logic:
  key  = "rl:<user_id>"         (sorted-set, member = timestamp-ms:sequence)
  1. Remove all members older than (now - window_ms).
  2. Count remaining members  → current vote tally in the window.
  3. If count + x > max_votes  → return 0 (BLOCKED).
  4. Otherwise add `x` members with score = now (unique via counter suffix).
  5. Set the key TTL to window size + 1 s.
  6. Return 1 (ALLOWED).

Cache key convention
────────────────────
  "votes:<candidate_id>"  →  STRING, value = Candidates.current_score (int)
"""

import time
import redis.asyncio as aioredis
from config import settings

# ── connection pool ───────────────────────────────────────────────────────────
_pool: aioredis.Redis | None = None


async def get_redis() -> aioredis.Redis:
    """Return the shared async Redis client (initialise on first call)."""
    global _pool
    if _pool is None:
        _pool = aioredis.Redis(
            host=settings.redis_host,
            port=settings.redis_port,
            password=settings.redis_password or None,
            db=settings.redis_db,
            decode_responses=True,
        )
    return _pool


async def close_redis() -> None:
    """Close the pool (called on app shutdown)."""
    global _pool
    if _pool:
        await _pool.aclose()
        _pool = None


# ── Lua rate-limit script ─────────────────────────────────────────────────────
_RATE_LIMIT_SCRIPT = """
local key        = KEYS[1]
local now_ms     = tonumber(ARGV[1])
local window_ms  = tonumber(ARGV[2])
local max_votes  = tonumber(ARGV[3])
local x          = tonumber(ARGV[4])
local nonce      = ARGV[5]

-- 1. remove expired entries
redis.call('ZREMRANGEBYSCORE', key, '-inf', now_ms - window_ms)

-- 2. count current entries in the window
local current = redis.call('ZCARD', key)

-- 3. calculate allowed votes
local allowed_x = x
if current + x > max_votes then
    allowed_x = max_votes - current
end

if allowed_x <= 0 then
    return 0
end

-- 4. add allowed_x new unique members (score = now_ms, member = now_ms:nonce:i)
for i = 1, allowed_x do
    redis.call('ZADD', key, now_ms, now_ms .. ':' .. nonce .. ':' .. i)
end

-- 5. refresh TTL
redis.call('EXPIRE', key, math.ceil(window_ms / 1000) + 1)

-- 6. return allowed votes
return allowed_x
"""

_script_sha: str | None = None


async def rate_limit_check(
    redis_client: aioredis.Redis, user_id: int, x: int
) -> int:
    """
    Run the sliding-window rate-limit Lua script keyed on user_id (int PK).

    Returns int > 0 → ALLOWED (number of votes permitted).
    Returns 0       → BLOCKED (caller returns HTTP 429).
    """
    global _script_sha

    if _script_sha is None:
        _script_sha = await redis_client.script_load(_RATE_LIMIT_SCRIPT)

    key = f"rl:{user_id}"
    now_ms = int(time.time() * 1000)
    window_ms = settings.rate_limit_window_seconds * 1000
    max_votes = settings.rate_limit_max_votes

    import uuid
    nonce = uuid.uuid4().hex

    result = await redis_client.evalsha(
        _script_sha,
        1,          # number of KEYS
        key,        # KEYS[1]
        now_ms,     # ARGV[1]
        window_ms,  # ARGV[2]
        max_votes,  # ARGV[3]
        x,          # ARGV[4]
        nonce,      # ARGV[5]
    )
    return int(result)


# ── cache helpers (keyed on candidate_id int PK) ──────────────────────────────

def candidate_cache_key(candidate_id: int) -> str:
    """Redis key for a candidate's current vote total."""
    return f"votes:{candidate_id}"


async def get_cached_votes(
    redis_client: aioredis.Redis, candidate_id: int
) -> int | None:
    """
    Step 2 – cache lookup.
    Returns the cached vote total (int) on HIT, or None on MISS.
    """
    value = await redis_client.get(candidate_cache_key(candidate_id))
    return int(value) if value is not None else None


async def set_cached_votes(
    redis_client: aioredis.Redis, candidate_id: int, total_votes: int
) -> None:
    """
    Step 4 – write-through after a PostgreSQL INSERT.
    Stores current_score with the configured TTL.
    """
    await redis_client.setex(
        candidate_cache_key(candidate_id),
        settings.cache_ttl_seconds,
        total_votes,
    )
