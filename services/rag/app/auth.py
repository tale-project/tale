"""Internal-token auth for the RAG service.

The RAG service is reachable on a private docker network from the platform
service. To prevent any caller on that network (or worse, a misconfigured
host-published port) from reading or deleting documents, every request
must carry a Bearer token matching `settings.internal_token`.

The token has a Docker-baked default (`tale-rag-dev-only`) so a fresh
`docker compose up` works without any operator config. Production operators
override the token via env / compose / k8s secret. When the default is in
use, startup logs a loud SECURITY warning.
"""

import hmac

from fastapi import Header, HTTPException, status
from loguru import logger

from .config import settings

DEFAULT_INTERNAL_TOKEN = "tale-rag-dev-only"


def _extract_bearer(header_value: str | None) -> str | None:
    if not header_value:
        return None
    parts = header_value.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


async def verify_internal_token(
    authorization: str | None = Header(default=None),
) -> None:
    """FastAPI dependency: validate Authorization: Bearer <token>.

    Raises 401 on missing/invalid token. Mounted at the router level;
    see `main.py` for the public-router exemption.
    """
    presented = _extract_bearer(authorization)
    if presented is None or not hmac.compare_digest(presented, settings.internal_token):
        # `hmac.compare_digest` does the constant-time compare; using `==`
        # leaks per-byte timing on the 401 path. The threat model is
        # "lateral mover with reach to rag:8001" — exactly the threat this
        # dependency exists to stop.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or missing internal token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def warn_if_default_token_in_use() -> None:
    """Emit a loud SECURITY warning when the baked-in default token is active.

    Called once at app startup. Operators see the line in `docker logs`
    every restart; it is intentionally not silenced — production operators
    should fix it by overriding `RAG_INTERNAL_TOKEN`.
    """
    if settings.internal_token != DEFAULT_INTERNAL_TOKEN:
        return

    if settings.require_custom_internal_token:
        # Strict production posture: refuse to start.
        msg = (
            "RAG_REQUIRE_CUSTOM_INTERNAL_TOKEN=true but the default "
            "RAG_INTERNAL_TOKEN is still in use. Set RAG_INTERNAL_TOKEN "
            "to a unique secret and restart."
        )
        logger.error("[SECURITY] {}", msg)
        raise RuntimeError(msg)

    logger.warning(
        "[SECURITY] Using default RAG_INTERNAL_TOKEN ({!r}) — override "
        "RAG_INTERNAL_TOKEN before exposing the RAG port to untrusted "
        "networks. Set RAG_REQUIRE_CUSTOM_INTERNAL_TOKEN=true to enforce.",
        DEFAULT_INTERNAL_TOKEN,
    )
