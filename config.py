"""
config.py
Loads and exposes all environment variables used across the project.
"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Redis
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_password: str = ""
    redis_db: int = 0

    # PostgreSQL
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "voting_db"
    postgres_user: str = "postgres"
    postgres_password: str = "your_password_here"

    # MongoDB
    mongodb_uri: str = "mongodb+srv://admin:admin123@cluster0.otugkkk.mongodb.net/?appName=Cluster0"
    mongodb_db: str = "voting_logs"
    
    # App-level knobs
    rate_limit_max_votes: int = 10       # max cumulative votes in the window
    rate_limit_window_seconds: int = 60  # sliding-window size (seconds)
    cache_ttl_seconds: int = 300         # Redis TTL for cached vote counts

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
