"""Configuration management for Tale Designer service.

Configuration is loaded from environment variables with the DESIGNER_ prefix.
AI model settings fall back to generic OPENAI_* env vars, with
OPENAI_DESIGN_MODEL used specifically for the document transformation agent.
"""

import os

from pydantic_settings import SettingsConfigDict
from tale_shared.config import BaseServiceSettings


class Settings(BaseServiceSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_prefix="DESIGNER_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Override base defaults
    port: int = 8005

    # Agent loop
    max_agent_iterations: int = 5
    request_timeout: int = 300

    # Pencil MCP server binary path (set in Docker via PENCIL_MCP_SERVER_PATH env)
    pencil_mcp_server_path: str = "/opt/pencil/resources/app.asar.unpacked/out/mcp-server-linux-x64"

    def get_design_model(self) -> str:
        """Get the design agent model.

        Checks OPENAI_DESIGN_MODEL first, then DESIGNER_DESIGN_MODEL,
        then falls back to OPENAI_FAST_MODEL.
        """
        model = os.environ.get("OPENAI_DESIGN_MODEL") or os.environ.get("DESIGNER_DESIGN_MODEL")
        if model:
            return model
        return self.get_fast_model()


# Global settings instance
settings = Settings()
