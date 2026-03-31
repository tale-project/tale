"""Loguru configuration helpers for Tale services."""

import logging
import sys

from loguru import logger


class _HealthCheckFilter(logging.Filter):
    """Filter out uvicorn access log entries for health check endpoints."""

    def filter(self, record: logging.LogRecord) -> bool:
        return "GET /health" not in record.getMessage()


def suppress_health_check_logs() -> None:
    """Attach a filter to uvicorn's access logger that drops /health requests."""
    logging.getLogger("uvicorn.access").addFilter(_HealthCheckFilter())


def configure_logging(*, level: str = "INFO", json_format: bool = False) -> None:
    """Configure loguru with consistent settings across services.

    Args:
        level: Log level (DEBUG, INFO, WARNING, ERROR).
        json_format: If True, output structured JSON logs.
    """
    logger.remove()

    if json_format:
        logger.add(
            sys.stderr,
            level=level.upper(),
            serialize=True,
        )
    else:
        logger.add(
            sys.stderr,
            level=level.upper(),
            format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
        )
