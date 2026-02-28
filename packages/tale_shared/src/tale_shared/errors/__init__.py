"""Common exception hierarchy for Tale services."""

from .base import ConfigError, ExtractionError, TaleError

__all__ = ["TaleError", "ConfigError", "ExtractionError"]
