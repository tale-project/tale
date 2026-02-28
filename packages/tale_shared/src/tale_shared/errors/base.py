"""Base exception classes for Tale services."""


class TaleError(Exception):
    """Base exception for all Tale service errors."""


class ConfigError(TaleError):
    """Raised when configuration is invalid or missing."""


class ExtractionError(TaleError):
    """Raised when text/content extraction fails."""
