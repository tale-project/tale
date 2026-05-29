"""Test configuration for the crawler service.

Provides an autouse fixture that binds the active-org ContextVar to
`"test-org"` for the duration of each test. Crawler routers and
services now read `get_active_org()` to scope work per-org; without
a binding they raise RuntimeError on first use.

The same fixture also resets the ContextVar after each test to keep
tests isolated under parallel runners.
"""

from collections.abc import Iterator

import pytest

from app.org_context import _active_org, set_active_org


@pytest.fixture(autouse=True)
def _bind_test_active_org() -> Iterator[None]:
    """Bind `set_active_org("test-org")` for the test, then reset."""
    token = _active_org.set("test-org")
    try:
        yield
    finally:
        _active_org.reset(token)


@pytest.fixture(autouse=True)
def _reset_vision_state() -> Iterator[None]:
    """Clear per-org AsyncOpenAI caches in vision/openai_client so a
    mock patched in test A does not get reused by test B."""
    from app.services.vision.cache import llm_cache
    from app.services.vision.openai_client import _chat_states, _vision_states

    _chat_states.clear()
    _vision_states.clear()
    llm_cache.clear()
    try:
        yield
    finally:
        _chat_states.clear()
        _vision_states.clear()
        llm_cache.clear()


__all__ = ["_bind_test_active_org", "set_active_org"]
