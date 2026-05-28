"""Per-request org-slug context for the crawler service.

Crawler internals (vision client, embedding service, file parsers, …)
need an org slug to read that org's provider catalog. Threading the slug
through every helper would touch ~15 call sites without adding signal —
the org is per-REQUEST, so a `contextvars.ContextVar` set by the
`require_org_slug` FastAPI dependency at the router boundary is the
right primitive:

- One write per request, at the boundary.
- Reads from any depth via `get_active_org()` — no parameter explosion.
- Per-asyncio-task isolation (ContextVar binds to the running task).

A missing context raises rather than silently falling back to `default`:
forgetting to set the header is a caller bug we want to surface as a
500, not as "served the wrong org's models for an hour".
"""

from contextvars import ContextVar

from fastapi import Header, HTTPException, status
from tale_shared.config.org_slug import ORG_SLUG_RE

_active_org: ContextVar[str | None] = ContextVar("tale_active_org", default=None)


def set_active_org(slug: str) -> None:
    """Bind the active org to the current asyncio task."""
    _active_org.set(slug)


def get_active_org() -> str:
    """Read the active org slug. Raises if unset (caller bug)."""
    value = _active_org.get()
    if not value:
        raise RuntimeError(
            "No active org slug for this request. Every public crawler "
            "endpoint must declare `org_slug: str = Depends(require_org_slug)` "
            "so the X-Tale-Org header is captured before service layer use."
        )
    return value


async def require_org_slug(
    x_tale_org: str | None = Header(default=None),
) -> str:
    """FastAPI dependency: extract + validate the X-Tale-Org header,
    bind it to the request-scoped ContextVar, and return it.

    Returns the slug so handlers that need it explicitly can also take
    `org_slug = Depends(require_org_slug)`. Internal helpers should
    prefer `get_active_org()` over plumbing the slug as a param.
    """
    if not x_tale_org:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="missing X-Tale-Org header",
        )
    if not ORG_SLUG_RE.match(x_tale_org):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid X-Tale-Org header",
        )
    set_active_org(x_tale_org)
    return x_tale_org
