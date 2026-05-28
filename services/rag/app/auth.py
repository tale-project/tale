"""Shared-secret auth for the RAG service.

The RAG service is reachable on a private docker network from the platform
service. To prevent any caller on that network (or worse, a misconfigured
host-published port) from reading or deleting documents, every request
must carry a Bearer token matching `settings.auth_token`.

Auth is presence-based: when `RAG_AUTH_TOKEN` is set on both the RAG and
platform containers (values must match), Bearer auth is enforced. When
unset, the dependency is a no-op and the service runs open — startup logs
a single loud SECURITY warning so operators see the state in `docker logs`.
"""

import hmac

from fastapi import Header, HTTPException, status
from loguru import logger
from tale_shared.config.org_slug import ORG_SLUG_RE

from .config import settings


def _extract_bearer(header_value: str | None) -> str | None:
    if not header_value:
        return None
    parts = header_value.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


async def verify_auth_token(
    authorization: str | None = Header(default=None),
) -> None:
    """FastAPI dependency: validate Authorization: Bearer <token>.

    No-op when `RAG_AUTH_TOKEN` is unset (auth disabled). Otherwise raises
    401 on missing/invalid token. Mounted at the router level; see
    `main.py` for the public-router exemption.
    """
    if settings.auth_token is None:
        return

    presented = _extract_bearer(authorization)
    if presented is None or not hmac.compare_digest(presented, settings.auth_token):
        # `hmac.compare_digest` does the constant-time compare; using `==`
        # leaks per-byte timing on the 401 path. The threat model is
        # "lateral mover with reach to rag:8001" — exactly the threat this
        # dependency exists to stop.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or missing auth token",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def require_org_slug(
    x_tale_org: str | None = Header(default=None),
) -> str:
    """FastAPI dependency: extract + validate the `X-Tale-Org` header.

    Every protected RAG endpoint requires this header. Caller-supplied;
    the platform sets it from the authenticated user's selected org.
    No fallback to `default` — a missing header is a caller bug that we
    surface as 400 rather than silently serve another org's providers.
    """
    if not x_tale_org:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="missing X-Tale-Org header",
        )
    # `fullmatch` rather than `match` so a trailing `\n` (which `$` would
    # accept) is rejected. Canonical validator at
    # `packages/tale_shared/src/tale_shared/config/org_slug.py:validate_org_slug`
    # uses fullmatch — keep this in lockstep. Round-3 P2 R21-P2-c.
    if not ORG_SLUG_RE.fullmatch(x_tale_org):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid X-Tale-Org header",
        )
    return x_tale_org


def warn_if_auth_disabled() -> None:
    """Emit a loud SECURITY warning when `RAG_AUTH_TOKEN` is unset.

    Called once at app startup. Operators see the line in `docker logs`
    every restart; it is intentionally not silenced — production operators
    should fix it by setting `RAG_AUTH_TOKEN` on both containers.
    """
    if settings.auth_token is not None:
        return

    logger.warning(
        "[SECURITY] RAG_AUTH_TOKEN unset — RAG service is unauthenticated. "
        "Set RAG_AUTH_TOKEN to a shared secret on both the platform and RAG "
        "containers (values must match) to enable Bearer auth.",
    )
