"""Org slug validation shared across all Python services.

Single source of truth so RAG, crawler, and `tale_shared.config.providers`
agree on what counts as a legal slug. Keep in lockstep with
`services/platform/lib/shared/constants/org-slug.ts`'s `ORG_SLUG_REGEX`.

The regex protects file-system writes against:
- `.` / `..` / absolute paths (e.g. `/etc/...`) — would silently rewrite
  to legacy flat layout (`Path("/app/data") / "." / "providers"` →
  `/app/data/providers`).
- shell metacharacters that could leak into log lines or process
  arguments.
- empty / whitespace-only slugs.
"""

from __future__ import annotations

import re

ORG_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


class InvalidOrgSlugError(ValueError):
    """Raised when an `org_slug` arg violates the canonical shape."""


def validate_org_slug(org_slug: str) -> str:
    """Return `org_slug` if it matches `ORG_SLUG_RE`; raise otherwise.

    Returns the slug unchanged so call sites can inline the check:
    `providers_dir = base / validate_org_slug(org_slug) / "providers"`.
    """
    if not isinstance(org_slug, str) or not ORG_SLUG_RE.fullmatch(org_slug):
        raise InvalidOrgSlugError(f"invalid org_slug {org_slug!r}: must match {ORG_SLUG_RE.pattern}")
    return org_slug
