"""Pre-ingestion secret scanner.

Wraps Yelp's `detect-secrets` library. Detection is done by its plugin
pipeline (AWS, Azure, Stripe, GitHub, JWT, private keys, and generic
keyword / entropy detectors); the library's default filters already remove
common false positives — UUIDs, indirect references like
``this.config.apiKey``, templated placeholders ``${foo}`` / ``<foo>``,
id-looking strings, lock and swagger files.

On top of that we apply a small post-filter for bareword placeholders
the library still flags (``REDACTED``, ``your-api-key-here``, ``null``,
etc.) — these sneak through because the KeywordDetector treats any value
after ``password:`` / ``secret:`` as a candidate.
"""

import re
import tempfile
from pathlib import Path

from detect_secrets import SecretsCollection
from detect_secrets.settings import transient_settings
from loguru import logger

# Enabled plugins. Keep the list explicit so bumping detect-secrets does
# not silently change behavior. Specific-provider detectors (Stripe,
# GitHub, OpenAI, …) stay first so their typed label shows up in the
# rejection reason when both a specific and generic detector match.
_PLUGINS: list[dict[str, object]] = [
    {"name": "AWSKeyDetector"},
    {"name": "ArtifactoryDetector"},
    {"name": "AzureStorageKeyDetector"},
    {"name": "BasicAuthDetector"},
    {"name": "CloudantDetector"},
    {"name": "DiscordBotTokenDetector"},
    {"name": "GitHubTokenDetector"},
    {"name": "GitLabTokenDetector"},
    {"name": "IbmCloudIamDetector"},
    {"name": "IbmCosHmacDetector"},
    {"name": "JwtTokenDetector"},
    {"name": "MailchimpDetector"},
    {"name": "NpmDetector"},
    {"name": "OpenAIDetector"},
    {"name": "PrivateKeyDetector"},
    {"name": "PypiTokenDetector"},
    {"name": "SendGridDetector"},
    {"name": "SlackDetector"},
    {"name": "SoftlayerDetector"},
    {"name": "SquareOAuthDetector"},
    {"name": "StripeDetector"},
    {"name": "TelegramBotTokenDetector"},
    {"name": "TwilioKeyDetector"},
    {"name": "KeywordDetector"},
    # Default entropy limits: Base64 4.5, Hex 3.0. Raising Base64 further
    # hides real secrets; lowering trips on innocuous identifiers.
    {"name": "Base64HighEntropyString", "limit": 4.5},
    {"name": "HexHighEntropyString", "limit": 3.0},
]

# Bareword placeholders the KeywordDetector still flags. detect-secrets
# has `is_templated_secret` for `${x}` / `<x>` / `{x}` but not for these
# plain-word conventions.
_PLACEHOLDER_VALUES: frozenset[str] = frozenset(
    {
        "",
        "null",
        "none",
        "nil",
        "undefined",
        "true",
        "false",
        "redacted",
        "placeholder",
        "example",
        "changeme",
        "xxx",
        "xxxx",
        "xxxxxxxx",
        "tbd",
        "todo",
        "fixme",
        "n/a",
    }
)

_PLACEHOLDER_PATTERNS: tuple[re.Pattern[str], ...] = (
    # `your-api-key-here`, `my_secret`, `example-token`, etc.
    re.compile(r"^(?:your|my|sample|example|test|fake|dummy|demo)[-_].+", re.I),
    # `...-goes-here`, `...-placeholder`, `...-example`.
    re.compile(r".+[-_](?:here|placeholder|example|sample|value|goes-here)$", re.I),
)

# Member-access chains (`config.apiKey`, `process.env.FOO`, `this.token`).
# KeywordDetector flags `secret: config.apiKey` because it treats the whole
# RHS as a candidate, but a dotted identifier expression is a reference,
# not a literal secret. Require at least one dot so a bare identifier
# (which could itself be a secret) still falls through to detection.
_MEMBER_ACCESS_RE = re.compile(r"^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$")


def _is_noise(secret_value: str | None) -> bool:
    """True when the detected value is a known placeholder, not a real secret."""
    if not secret_value:
        return True
    stripped = secret_value.strip().strip("'\"`")
    if not stripped:
        return True
    lowered = stripped.lower()
    if lowered in _PLACEHOLDER_VALUES:
        return True
    if any(p.match(lowered) for p in _PLACEHOLDER_PATTERNS):
        return True
    return bool(_MEMBER_ACCESS_RE.match(stripped))


def scan_file_for_secrets(file_bytes: bytes) -> tuple[bool, str | None]:
    """Scan file content for credential patterns.

    Returns ``(rejected, reason)``. When rejected is True the upload must
    not be indexed; ``reason`` contains the detect-secrets detector label
    (e.g. ``"AWS Access Key"``, ``"Secret Keyword"``).

    Detector errors (malformed bytes, I/O failures) fail open — log and
    allow the upload rather than block it.
    """
    try:
        # detect-secrets scans a file path, so write to a temp file.
        # `/tmp` is tmpfs in the Docker image, so this is an in-memory
        # round-trip with no real disk I/O.
        with tempfile.NamedTemporaryFile(mode="wb", suffix=".txt", delete=False) as tf:
            tf.write(file_bytes)
            tmp_path = Path(tf.name)

        try:
            collection = SecretsCollection()
            with transient_settings({"plugins_used": _PLUGINS}):
                collection.scan_file(str(tmp_path))
        finally:
            tmp_path.unlink(missing_ok=True)
    except Exception:
        logger.exception("Secret scan failed; allowing file")
        return False, None

    for _filename, secret in collection:
        value = secret.secret_value or ""
        if _is_noise(value):
            logger.info(
                "Secret scanner: filtered placeholder match",
                extra={"type": secret.type, "value_len": len(value)},
            )
            continue
        logger.warning(
            "File rejected by secret scanner",
            extra={"type": secret.type, "value_len": len(value)},
        )
        return True, f"Potential secret detected: {secret.type}"

    return False, None
