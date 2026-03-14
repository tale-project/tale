"""asyncpg connection acquisition and transaction retry with stamina."""

from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from typing import AsyncIterator, TypeVar

import asyncpg
import stamina
from loguru import logger

T = TypeVar("T")

_TRANSIENT_ERRORS = (
    asyncpg.CannotConnectNowError,
    asyncpg.TooManyConnectionsError,
    TimeoutError,
    OSError,
)

_CONNECTION_ERRORS = (
    asyncpg.PostgresConnectionError,
    asyncpg.InterfaceError,
    *_TRANSIENT_ERRORS,
)


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
    conn = None
    async for attempt in stamina.retry_context(
        on=_TRANSIENT_ERRORS,
        attempts=attempts,
        timeout=timeout,
    ):
        with attempt:
            conn = await pool.acquire()
    if conn is None:
        raise RuntimeError("Failed to acquire database connection after retries")
    try:
        yield conn
    finally:
        try:
            await pool.release(conn)
        except Exception:
            logger.warning("Failed to release connection back to pool")


async def transact_with_retry(
    pool: asyncpg.Pool,
    callback: Callable[[asyncpg.Connection], Awaitable[T]],
    *,
    attempts: int = 3,
    timeout: int = 120,
) -> T:
    """Acquire a connection, open a transaction, and execute *callback*.

    Retries the entire acquire → transaction → execute cycle on transient
    connection errors.  Each retry gets a fresh connection from the pool.

    Args:
        pool: The asyncpg connection pool.
        callback: Async callable receiving a connection with an active transaction.
        attempts: Maximum number of retry attempts.
        timeout: Wall-clock budget in seconds for all attempts combined.

    Returns:
        Whatever *callback* returns.
    """
    result: T
    async for attempt in stamina.retry_context(
        on=_CONNECTION_ERRORS,
        attempts=attempts,
        timeout=timeout,
    ):
        with attempt:
            async with pool.acquire() as conn, conn.transaction():
                result = await callback(conn)
    return result
