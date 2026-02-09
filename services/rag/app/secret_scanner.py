"""Pre-ingestion scanner that detects credential patterns in file content."""

import re

from loguru import logger

_SECRET_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("API key assignment", re.compile(r"(?i)api[_-]?key\s*[=:]\s*\S+")),
    ("Password assignment", re.compile(r"(?i)password\s*[=:]\s*\S+")),
    ("Secret assignment", re.compile(r"(?i)secret\s*[=:]\s*\S+")),
    ("Token assignment", re.compile(r"(?i)token\s*[=:]\s*\S+")),
    ("Private key assignment", re.compile(r"(?i)private[_-]?key\s*[=:]\s*\S+")),
    ("Bearer token", re.compile(r"Bearer\s+[A-Za-z0-9\-_.]{20,}")),
    (
        "Connection string",
        re.compile(
            r"(?i)(?:mongodb|postgres|mysql|redis|amqp|mssql)"
            r"(?:\+\w+)?://\S+"
        ),
    ),
    ("AWS access key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("Hex token (40+ chars)", re.compile(r"(?i)(?:key|secret|token|password)\s*[=:]\s*[0-9a-f]{40,}")),
    ("Base64 token (40+ chars)", re.compile(r"(?i)(?:key|secret|token|password)\s*[=:]\s*[A-Za-z0-9+/]{40,}={0,2}")),
    ("PEM private key block", re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----")),
]


def scan_file_for_secrets(file_bytes: bytes) -> tuple[bool, str | None]:
    """Scan file content for credential patterns.

    Args:
        file_bytes: Raw bytes of the uploaded file.

    Returns:
        A tuple of (rejected, reason). If rejected is True, the file should
        not be indexed and reason describes the match.
    """
    try:
        text = file_bytes.decode("utf-8", errors="ignore")
    except Exception:
        return False, None

    for label, pattern in _SECRET_PATTERNS:
        match = pattern.search(text)
        if match:
            snippet = match.group()[:60]
            reason = f"Potential secret detected ({label}): '{snippet}...'"
            logger.warning(
                "File rejected by secret scanner",
                extra={"pattern": label, "snippet": snippet},
            )
            return True, reason

    return False, None
