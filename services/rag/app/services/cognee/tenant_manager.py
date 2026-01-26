"""Team tenant management for Cognee multi-tenancy.

This module provides functions to manage team-level isolation in Cognee by creating
and retrieving "service users" that represent teams. Each team has its own service
user and tenant, allowing for tenant-level data isolation.

Design:
- Service users are created with email format: service@team_{team_id}.tale.internal
- Each service user owns a tenant named: tale_team_{team_id}
- Operations performed with a service user's context are scoped to that team's tenant
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any
from uuid import UUID

import cognee
from loguru import logger

from .utils import sanitize_team_id, validate_team_id

if TYPE_CHECKING:
    pass

# Cache for team contexts to avoid repeated database lookups
_team_context_cache: dict[str, Any] = {}
_cache_lock = asyncio.Lock()


async def ensure_cognee_user_tables() -> None:
    """Ensure Cognee user/tenant database tables exist.

    This must be called before any user management operations when
    ENABLE_BACKEND_ACCESS_CONTROL is enabled. It triggers Cognee's
    internal initialization by adding a minimal test document.

    The function is idempotent - safe to call multiple times.
    """
    # Use Cognee's public API to trigger internal table creation
    # Adding a simple text document causes Cognee to initialize all required tables
    await cognee.add("init", dataset_name="_tale_init")
    logger.info("Cognee database tables initialized via cognee.add()")


def _get_service_email(team_id: str) -> str:
    """Generate service user email for a team.

    Uses plus-addressing format to avoid invalid characters in domain names.
    Email format: service+team_{team_id}@tale.internal

    Note: team_id should be pre-sanitized before calling this function.
    """
    return f"service+team_{team_id}@tale.internal"


def _get_tenant_name(team_id: str) -> str:
    """Generate tenant name for a team.

    Note: team_id should be pre-sanitized before calling this function.
    """
    return f"tale_team_{team_id}"


async def get_or_create_team_context(team_id: str) -> Any:
    """Get or create a team's service user and tenant context.

    This function retrieves or creates a Cognee User object that represents
    the team for multi-tenant operations. The service user is associated with
    a tenant that isolates the team's data.

    The team_id is automatically sanitized to ensure it's safe for use in
    Cognee dataset names and email addresses.

    Args:
        team_id: The team identifier (e.g., from tale_team_{teamId} dataset name)

    Returns:
        Cognee User object representing the team's service context

    Raises:
        ValueError: If team_id is empty or invalid after sanitization
        Exception: If user/tenant creation fails for unexpected reasons
    """
    # Sanitize team_id to ensure it's safe for Cognee
    original_team_id = team_id
    team_id = sanitize_team_id(team_id)

    if not team_id:
        raise ValueError(f"Invalid team_id: '{original_team_id}' (empty after sanitization)")

    if original_team_id != team_id:
        logger.warning(
            f"team_id was sanitized: '{original_team_id}' -> '{team_id}'"
        )

    # Check cache first (fast path)
    if team_id in _team_context_cache:
        logger.debug(f"Using cached team context for team_id={team_id}")
        return _team_context_cache[team_id]

    async with _cache_lock:
        # Double-check after acquiring lock
        if team_id in _team_context_cache:
            return _team_context_cache[team_id]

        service_email = _get_service_email(team_id)
        tenant_name = _get_tenant_name(team_id)

        logger.info(f"Getting or creating team context for team_id={team_id}")

        try:
            from cognee.modules.users.methods import create_user, get_user

            # Try to get existing user first (avoids exception handling complexity)
            user = await _get_user_by_email(service_email)
            if user is not None:
                logger.debug(f"Found existing service user for team_id={team_id}")
                _team_context_cache[team_id] = user
                logger.info(f"Team context ready for team_id={team_id}, user_id={user.id}, tenant_id={user.tenant_id}")
                return user

            # User doesn't exist, create new one
            user = await create_user(
                email=service_email,
                password=f"internal_service_{team_id}",
                is_superuser=False,
            )
            logger.info(f"Created new service user for team_id={team_id}: {user.id}")

            # Create tenant for the new user
            from cognee.modules.users.tenants.methods import create_tenant

            await create_tenant(tenant_name, user.id)
            logger.info(f"Created tenant '{tenant_name}' for team_id={team_id}")

            # Refresh user to get updated tenant_id
            user = await get_user(user.id)

            # Cache the result
            _team_context_cache[team_id] = user
            logger.info(f"Team context ready for team_id={team_id}, user_id={user.id}, tenant_id={user.tenant_id}")
            return user

        except Exception as e:
            logger.error(f"Failed to get/create team context for team_id={team_id}: {e}")
            raise


async def _get_user_by_email(email: str) -> Any | None:
    """Get a user by email address.

    Uses Cognee's built-in get_user_by_email method for proper session handling.

    Args:
        email: The email address to search for

    Returns:
        User object if found, None otherwise
    """
    try:
        from cognee.modules.users.methods import get_user_by_email

        user = await get_user_by_email(email)
        return user

    except Exception as e:
        error_str = str(e)
        # User not found is expected - don't log as warning
        if "not found" in error_str.lower():
            logger.debug(f"User not found by email {email}")
            return None
        logger.warning(f"Failed to get user by email {email}: {type(e).__name__}: {e}")
        return None


def string_to_uuid(value: str) -> UUID:
    """Convert any string to a deterministic UUID using uuid5.

    This ensures that the same input string always produces the same UUID,
    making it suitable for consistent user identification.

    Args:
        value: Any string value to convert

    Returns:
        A deterministic UUID based on the input string
    """
    import uuid

    # Use DNS namespace as a consistent namespace for our UUIDs
    return uuid.uuid5(uuid.NAMESPACE_DNS, f"tale.user.{value}")


async def get_or_create_user_for_context(user_id: str | UUID) -> Any | None:
    """Get or create a Cognee user by ID for use as operation context.

    This function retrieves or creates a user for user-level isolation.
    Users are identified by a deterministic email generated from the user_id.

    Args:
        user_id: The user ID (string or UUID). Used to generate a deterministic
                 email for user lookup/creation.

    Returns:
        Cognee User object (existing or newly created), or None on error
    """
    original_user_id = str(user_id)

    try:
        from cognee.modules.users.methods import create_user, get_user
        from cognee.modules.users.tenants.methods import create_tenant

        # Generate deterministic email from user_id
        # This ensures the same user_id always maps to the same user
        deterministic_uuid = string_to_uuid(original_user_id)
        email = f"user+{deterministic_uuid}@tale.internal"
        tenant_name = f"tale_user_{str(deterministic_uuid)[:8]}"

        # Try to get existing user by email first
        existing_user = await _get_user_by_email(email)
        if existing_user:
            logger.debug(f"Found existing user for user_id={original_user_id}: {existing_user.id}")
            return existing_user

        # User doesn't exist, create new one
        user = await create_user(
            email=email,
            password=f"internal_user_{deterministic_uuid}",
            is_superuser=False,
        )
        logger.info(f"Created new user for user_id={original_user_id}: {user.id}")

        # Create tenant for the new user
        await create_tenant(tenant_name, user.id)
        logger.info(f"Created tenant '{tenant_name}' for user_id={original_user_id}")

        # Refresh user to get updated tenant_id
        user = await get_user(user.id)

        return user

    except Exception as e:
        logger.warning(f"Failed to get/create user {original_user_id}: {e}")
        return None


def clear_team_context_cache() -> None:
    """Clear the team context cache.

    Useful for testing or when tenant configurations change.
    """
    _team_context_cache.clear()
    logger.info("Team context cache cleared")
