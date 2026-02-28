"""Loguru configuration helpers for Tale services."""

import sys

from loguru import logger


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
