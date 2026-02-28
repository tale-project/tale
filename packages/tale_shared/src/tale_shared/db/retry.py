"""asyncpg connection acquisition with stamina-based retry."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg
import stamina

_TRANSIENT_ERRORS = (asyncpg.CannotConnectNowError, OSError)


@asynccontextmanager
async def acquire_with_retry(
    pool: asyncpg.Pool,
    *,
    attempts: int = 5,
    timeout: int = 30,
) -> AsyncIterator[asyncpg.Connection]:
    """Acquire a pooled connection, retrying on transient DB errors.

    Args:
        pool: The asyncpg connection pool.
        attempts: Maximum number of retry attempts.
        timeout: Total timeout in seconds for all attempts.

    Yields:
        An asyncpg connection from the pool.
    """
    async for attempt in stamina.retry_context(
        on=_TRANSIENT_ERRORS,
        attempts=attempts,
        timeout=timeout,
    ):
        with attempt:
            conn = await pool.acquire()
    try:
        yield conn
    finally:
        await pool.release(conn)
