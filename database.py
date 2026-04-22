import asyncpg
from config import settings

_pool: asyncpg.Pool | None = None


# ── pool management ───────────────────────────────────────────────────────────

async def get_db_pool() -> asyncpg.Pool:
    """Return the shared connection pool (initialise on first call)."""
    global _pool
    if _pool is None:
        dsn = (
            f"postgresql://{settings.postgres_user}:{settings.postgres_password}"
            f"@{settings.postgres_host}:{settings.postgres_port}/{settings.postgres_db}"
        )
        _pool = await asyncpg.create_pool(dsn=dsn, min_size=2, max_size=10)
    return _pool


async def close_db_pool() -> None:
    """Close the pool (called on app shutdown)."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


# ── lookup helpers ────────────────────────────────────────────────────────────

async def get_user_id(pool: asyncpg.Pool, username: str) -> int | None:
    """
    Return the user_id for *username*, or None if the user does not exist.
    The endpoint uses the username string supplied by the caller; we resolve
    it to the integer PK before inserting into Votes.
    """
    row = await pool.fetchrow(
        "SELECT user_id FROM Users WHERE username = $1",
        username,
    )
    return row["user_id"] if row else None


async def get_candidate_id(pool: asyncpg.Pool, candidate_name: str) -> int | None:
    """
    Return the candidate_id for *candidate_name*, or None if not found.
    Matching is case-insensitive so 'alice' and 'Alice' resolve to the same row.
    """
    row = await pool.fetchrow(
        "SELECT candidate_id FROM Candidates WHERE LOWER(candidate_name) = LOWER($1)",
        candidate_name,
    )
    return row["candidate_id"] if row else None


# ── write helper ──────────────────────────────────────────────────────────────

async def insert_votes(
    pool: asyncpg.Pool,
    user_id: int,
    candidate_id: int,
    x: int,
) -> None:
    """
    Step 3a – persist the votes to PostgreSQL inside a single transaction:
      1. INSERT a row into Votes.
      2. Increment Candidates.current_score by x  (keeps the denormalised
         counter in sync so we never need a full SUM() just to read the score).
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO Votes (user_id, candidate_id, num_of_votes)
                VALUES ($1, $2, $3)
                """,
                user_id,
                candidate_id,
                x,
            )
            await conn.execute(
                """
                UPDATE Candidates
                SET current_score = current_score + $1
                WHERE candidate_id = $2
                """,
                x,
                candidate_id,
            )


# ── read helper ───────────────────────────────────────────────────────────────

async def fetch_total_votes(pool: asyncpg.Pool, candidate_id: int) -> int:
    """
    Step 3b – retrieve the current total for *candidate_id*.

    We read current_score from Candidates (O(1) lookup on PK) rather than
    doing a SUM() over the Votes table, because insert_votes() keeps
    current_score perfectly in sync via the same transaction.
    """
    row = await pool.fetchrow(
        "SELECT current_score FROM Candidates WHERE candidate_id = $1",
        candidate_id,
    )
    return int(row["current_score"]) if row else 0
