"""
main.py
FastAPI entry-point – Voting Backend

Endpoint
────────
POST /vote

4-Step flow per request
───────────────────────
Step 1 │ Redis Lua rate-limiter
       │   ✔ allowed  → continue
       │   ✗ blocked  → HTTP 429

Step 2 │ Redis cache lookup  (key: "votes:<candidate>")
       │   HIT  → return cached total immediately (no DB call)
       │   MISS → continue to Step 3

Step 3 │ PostgreSQL
       │   INSERT new vote row
       │   SELECT SUM(vote_count) for candidate

Step 4 │ Write-through cache
       │   Store fresh total in Redis with TTL
       │   Return result to caller
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware

import redis.asyncio as aioredis
import asyncpg

from config import settings
from schemas import VoteRequest, VoteResponse
from redis_client import (
    get_redis,
    close_redis,
    rate_limit_check,
    get_cached_votes,
    set_cached_votes,
)
from database import get_db_pool, close_db_pool, insert_votes, fetch_total_votes, get_user_id, get_candidate_id

# ── logging ──────────────────────────────────────────────────────────────────
import sys
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    handlers=[
        logging.FileHandler("system.log", encoding="utf-8"),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("voting")


# ── lifespan (startup / shutdown) ─────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Connections are lazy – pools are created on first real request so the
    # server boots successfully even when Redis / PostgreSQL are not ye2t up.
    logger.info("Server starting up (connections are lazy) …")
    yield
    logger.info("Shutting down – closing connections …")
    await close_redis()
    await close_db_pool()
    logger.info("Shutdown complete.")


# ── app ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Voting Backend",
    description=(
        "Redis-accelerated voting API with Lua rate-limiting, "
        "read-through cache, and PostgreSQL persistence."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # tighten for production
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── dependency injectors ──────────────────────────────────────────────────────
async def dep_redis() -> aioredis.Redis:
    return await get_redis()


async def dep_db() -> asyncpg.Pool:
    return await get_db_pool()


# ── endpoint ──────────────────────────────────────────────────────────────────
@app.post(
    "/vote",
    response_model=VoteResponse,
    summary="Vote X Times",
    description=(
        "Cast `x` votes for `candidate` on behalf of `user`. "
        "Rate-limited via a Redis Lua sliding-window; "
        "results are served from cache when available."
    ),
    tags=["Voting"],
)
async def vote_x_times(
    payload: VoteRequest,
    redis_client: aioredis.Redis = Depends(dep_redis),
    db_pool: asyncpg.Pool = Depends(dep_db),
) -> VoteResponse:
    """
    POST /vote
    Body: { "x": int, "candidate": str, "user": str }
    """
    x = payload.x
    candidate_name = payload.candidate
    username = payload.user

    logger.info("Received vote request | user=%s candidate=%s x=%d", username, candidate_name, x)

    # ── Resolve IDs from DB ───────────────────────────────────────────────────
    user_id = await get_user_id(db_pool, username)
    if not user_id:
        raise HTTPException(status_code=404, detail=f"User '{username}' not found")
        
    candidate_id = await get_candidate_id(db_pool, candidate_name)
    if not candidate_id:
        raise HTTPException(status_code=404, detail=f"Candidate '{candidate_name}' not found")

    # ── Step 1: Redis Lua rate-limit ──────────────────────────────────────────
    logger.info("  [Step 1] Checking rate-limit for user_id=%d …", user_id)
    allowed = await rate_limit_check(redis_client, user_id, x)
    if not allowed:
        logger.warning("  [Step 1] BLOCKED – user=%s exceeded rate limit", username)
        raise HTTPException(
            status_code=429,
            detail=(
                f"Rate limit exceeded: user '{username}' may cast at most "
                f"{settings.rate_limit_max_votes} votes every "
                f"{settings.rate_limit_window_seconds} seconds."
            ),
        )
    logger.info("  [Step 1] ALLOWED")

    # ── Step 2: Redis cache lookup ────────────────────────────────────────────
    logger.info("  [Step 2] Cache lookup for candidate_id=%d …", candidate_id)
    cached_total = await get_cached_votes(redis_client, candidate_id)

    if cached_total is not None:
        # CACHE HIT – optimistic: return the cached total + x (votes not yet persisted).
        # If strict consistency is required, skip this block and always hit Postgres.
        logger.info("  [Step 2] CACHE HIT  (total=%d, adding %d in-flight)", cached_total, x)

        # Still persist the votes to PostgreSQL asynchronously (fire-and-forget style
        # or inline – here we do it inline for data integrity).
        await insert_votes(db_pool, user_id, candidate_id, x)
        updated_total = cached_total + x
        await set_cached_votes(redis_client, candidate_id, updated_total)

        return VoteResponse(
            status="ok",
            candidate_id=candidate_id,
            candidate_name=candidate_name,
            user_id=user_id,
            username=username,
            votes_cast=x,
            total_votes=updated_total,
            source="cache",
            message=f"{x} vote(s) recorded for '{candidate_name}'. Total (from cache): {updated_total}.",
        )

    # ── Step 3: PostgreSQL – insert + fetch ───────────────────────────────────
    logger.info("  [Step 2] CACHE MISS – querying PostgreSQL …")
    logger.info("  [Step 3] Inserting %d vote(s) for candidate_id=%d …", x, candidate_id)
    await insert_votes(db_pool, user_id, candidate_id, x)

    logger.info("  [Step 3] Fetching updated total from PostgreSQL …")
    db_total = await fetch_total_votes(db_pool, candidate_id)
    logger.info("  [Step 3] DB total=%d", db_total)

    # ── Step 4: Write-through cache ───────────────────────────────────────────
    logger.info("  [Step 4] Writing total=%d to Redis (TTL=%ds) …", db_total, settings.cache_ttl_seconds)
    await set_cached_votes(redis_client, candidate_id, db_total)

    return VoteResponse(
        status="ok",
        candidate_id=candidate_id,
        candidate_name=candidate_name,
        user_id=user_id,
        username=username,
        votes_cast=x,
        total_votes=db_total,
        source="database",
        message=f"{x} vote(s) recorded for '{candidate_name}'. Total (from DB): {db_total}.",
    )


# ── health check ──────────────────────────────────────────────────────────────
@app.get("/health", tags=["Meta"], summary="Health check")
async def health():
    return {"status": "ok"}
