"""Configuration for the Graph DB service."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings."""

    # Server settings
    host: str = "0.0.0.0"
    port: int = 8000

    # Database settings
    database_path: str = "/data/kuzu_db"

    class Config:
        env_prefix = "GRAPH_DB_"


settings = Settings()

