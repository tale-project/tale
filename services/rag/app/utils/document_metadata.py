"""Validation for the flat document-metadata bag (#1517).

`private_knowledge.documents.metadata` stores a FLAT map of scalar
values (department, year, document_type, …) that /search can filter on
via JSONB containment. Two callers share these rules:

- Ingestion (`upload_document`): the upload `metadata` form field is a
  free-form JSON blob that also carries transport keys
  (`source_created_at`, `folder_path`, `content_type`, …). Those are
  consumed elsewhere; `sanitize_document_metadata` strips them and any
  non-conforming values, warning instead of failing the upload.
- The strict pydantic surfaces (`SearchFilters.metadata`,
  `PATCH /documents/metadata`): `validate_metadata_object` rejects bad
  shapes loudly — those callers are platform code, not end-user blobs.
"""

from __future__ import annotations

from typing import Any

from loguru import logger

MAX_METADATA_KEYS = 20
MAX_METADATA_KEY_LENGTH = 64
MAX_METADATA_STRING_LENGTH = 512
MAX_METADATA_LIST_ITEMS = 50

# Keys consumed by dedicated columns / transport concerns — never stored
# in (or filterable through) the metadata bag.
RESERVED_METADATA_KEYS = frozenset(
    {
        "source_created_at",
        "source_modified_at",
        "folder_path",
        "content_type",
        "file_id",
        "filename",
    }
)

_SCALAR_TYPES = (str, int, float, bool)


def _valid_scalar(value: object) -> bool:
    if isinstance(value, str):
        return len(value) <= MAX_METADATA_STRING_LENGTH
    return isinstance(value, _SCALAR_TYPES)


def validate_metadata_object(value: dict[str, Any], *, allow_lists: bool) -> dict[str, Any]:
    """Validate a metadata map strictly; raise ``ValueError`` on violation.

    `allow_lists=True` admits list-of-scalar values (the IN-filter form
    used by `SearchFilters.metadata`); stored metadata is scalar-only.
    """
    if len(value) > MAX_METADATA_KEYS:
        raise ValueError(f"metadata exceeds {MAX_METADATA_KEYS} keys")
    for key, item in value.items():
        if not key or len(key) > MAX_METADATA_KEY_LENGTH:
            raise ValueError(f"metadata key must be 1-{MAX_METADATA_KEY_LENGTH} characters: {key[:80]!r}")
        if key in RESERVED_METADATA_KEYS:
            raise ValueError(f"metadata key is reserved: {key!r}")
        if isinstance(item, list):
            if not allow_lists:
                raise ValueError(f"metadata value for {key!r} must be a scalar")
            if not item or len(item) > MAX_METADATA_LIST_ITEMS:
                raise ValueError(f"metadata list for {key!r} must have 1-{MAX_METADATA_LIST_ITEMS} items")
            if not all(_valid_scalar(v) for v in item):
                raise ValueError(f"metadata list for {key!r} must contain only scalars")
        elif not _valid_scalar(item):
            raise ValueError(f"metadata value for {key!r} must be a string, number, or boolean")
    return value


def sanitize_document_metadata(parsed: dict[str, Any]) -> dict[str, Any]:
    """Extract the storable metadata map from an upload `metadata` blob.

    Lenient counterpart of `validate_metadata_object`: reserved keys are
    silently skipped (they are legitimate transport fields), anything
    else non-conforming is dropped with a warning. Never raises — a bad
    metadata value must not fail the upload.
    """
    sanitized: dict[str, Any] = {}
    for key, value in parsed.items():
        if key in RESERVED_METADATA_KEYS:
            continue
        if len(sanitized) >= MAX_METADATA_KEYS:
            logger.warning("Ignoring document metadata beyond {} keys", MAX_METADATA_KEYS)
            break
        if not key or len(key) > MAX_METADATA_KEY_LENGTH:
            logger.warning("Ignoring over-long document metadata key ({} chars)", len(key))
            continue
        if not _valid_scalar(value):
            logger.warning("Ignoring non-scalar document metadata value for key {!r}", key)
            continue
        sanitized[key] = value
    return sanitized
