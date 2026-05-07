"""
mongodb_logger.py
Manages MongoDB async client and provides logging functions for vote/api/abuse logs.
"""

from datetime import datetime, timezone
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import PyMongoError

from config import settings

# ──────────────────────────────────────────────────────────────────────────────
# MongoDB client
# ──────────────────────────────────────────────────────────────────────────────

_mongo_client: Optional[AsyncIOMotorClient] = None
_mongo_db: Optional[AsyncIOMotorDatabase] = None


async def get_mongo_client() -> AsyncIOMotorClient:
    """
    Return shared MongoDB async client.
    Creates it once on first use.
    """
    global _mongo_client

    if _mongo_client is None:
        _mongo_client = AsyncIOMotorClient(
            settings.mongodb_uri,
            serverSelectionTimeoutMS=5000,
            tls=True,
            retryWrites=True,
        )

    return _mongo_client


async def get_mongo_db() -> AsyncIOMotorDatabase:
    """
    Return configured database.
    """
    global _mongo_db

    if _mongo_db is None:
        client = await get_mongo_client()
        _mongo_db = client[settings.mongodb_db]

    return _mongo_db


async def close_mongo() -> None:
    """
    Close MongoDB connection on shutdown.
    """
    global _mongo_client, _mongo_db

    if _mongo_client is not None:
        _mongo_client.close()

    _mongo_client = None
    _mongo_db = None


# ──────────────────────────────────────────────────────────────────────────────
# Internal helper
# ──────────────────────────────────────────────────────────────────────────────

async def _safe_insert(collection_name: str, document: dict) -> None:
    """
    Insert without crashing app if MongoDB is unavailable.
    """
    try:
        db = await get_mongo_db()
        await db[collection_name].insert_one(document)
    except PyMongoError as e:
        print(f"[MongoDB Logger Error] {collection_name}: {e}")
    except Exception as e:
        print(f"[Logger Unexpected Error] {collection_name}: {e}")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


# ──────────────────────────────────────────────────────────────────────────────
# Public logging functions
# ──────────────────────────────────────────────────────────────────────────────

async def log_vote(
    user_id: int,
    candidate_id: int,
    num_of_votes: int,
    status: str = "success",
) -> None:
    await _safe_insert(
        "vote_logs",
        {
            "user_id": user_id,
            "candidate_id": candidate_id,
            "num_of_votes": num_of_votes,
            "status": status,
            "created_at": _utc_now(),
        },
    )


async def log_api_call(
    endpoint: str,
    method: str,
    status_code: int,
    user_id: Optional[int] = None,
    error_message: Optional[str] = None,
) -> None:
    doc = {
        "endpoint": endpoint,
        "method": method,
        "status_code": status_code,
        "created_at": _utc_now(),
    }

    if user_id is not None:
        doc["user_id"] = user_id

    if error_message:
        doc["error_message"] = error_message

    await _safe_insert("api_logs", doc)


async def log_abuse(
    user_id: int,
    type: str,
    candidate_id: Optional[int] = None,
    blocked_count: int = 1,
) -> None:
    doc = {
        "user_id": user_id,
        "type": type,
        "blocked_count": blocked_count,
        "created_at": _utc_now(),
    }

    if candidate_id is not None:
        doc["candidate_id"] = candidate_id

    await _safe_insert("abuse_logs", doc)