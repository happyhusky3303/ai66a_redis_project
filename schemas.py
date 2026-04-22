"""
schemas.py
Pydantic request / response models aligned to the real DB schema.
"""
from pydantic import BaseModel, Field


class VoteRequest(BaseModel):
    x: int = Field(..., ge=1, description="Number of votes to cast (must be ≥ 1)")
    candidate: str = Field(
        ..., min_length=1,
        description="candidate_name as stored in the Candidates table (case-insensitive)"
    )
    user: str = Field(
        ..., min_length=1,
        description="username as stored in the Users table"
    )


class VoteResponse(BaseModel):
    status: str           # "ok"
    candidate_id: int     # resolved PK
    candidate_name: str
    user_id: int          # resolved PK
    username: str
    votes_cast: int
    total_votes: int      # Candidates.current_score after this request
    source: str           # "cache" | "database"
    message: str
