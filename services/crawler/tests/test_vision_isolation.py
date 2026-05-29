"""Cross-org isolation for the vision pipeline.

Two regression suites:

1. `VisionClient._get_client` (and the chat-config variant used by
   `process_pages_with_llm`) must NOT reuse another org's
   `AsyncOpenAI` instance. Earlier code held a single module-level
   client + config tuple, so within a 15s TTL org B's request would
   reuse org A's API key + base_url.

2. `llm_cache` (OCR / description / LLM) must NOT serve org A's
   cached output to org B. Earlier code keyed the cache by
   `sha256(content)` only.

These tests bypass the autouse `test-org` binding via `set_active_org`
to simulate two distinct orgs landing on the same shared crawler
process.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.org_context import set_active_org
from app.services.vision.cache import llm_cache
from app.services.vision.openai_client import (
    VisionClient,
    _chat_states,
    _vision_states,
    process_pages_with_llm,
)


class TestVisionClientPerOrg:
    @patch("app.services.vision.openai_client.settings")
    @patch("app.services.vision.openai_client.AsyncOpenAI")
    def test_two_orgs_get_separate_clients(self, mock_openai_cls: MagicMock, mock_settings: MagicMock) -> None:
        # Each org sees its own provider config.
        configs = {
            "org-a": ("https://a.example", "key-a", "model-a"),
            "org-b": ("https://b.example", "key-b", "model-b"),
        }
        mock_settings.get_vision_config.side_effect = lambda slug: configs[slug]

        # Two distinct AsyncOpenAI instances on the two constructor calls.
        client_a = MagicMock(name="client_a")
        client_b = MagicMock(name="client_b")
        mock_openai_cls.side_effect = [client_a, client_b]

        client = VisionClient()

        set_active_org("org-a")
        first = client._get_client()
        set_active_org("org-b")
        second = client._get_client()

        assert first is client_a
        assert second is client_b
        assert _vision_states["org-a"].client is client_a
        assert _vision_states["org-b"].client is client_b

        # The constructor was called with each org's own api_key — proving
        # the singleton-reuse leak is gone.
        kwargs_seen = [call.kwargs for call in mock_openai_cls.call_args_list]
        assert {kw["api_key"] for kw in kwargs_seen} == {"key-a", "key-b"}

    @patch("app.services.vision.openai_client.settings")
    @patch("app.services.vision.openai_client.AsyncOpenAI")
    def test_org_a_request_does_not_get_org_b_client_within_ttl(
        self, mock_openai_cls: MagicMock, mock_settings: MagicMock
    ) -> None:
        configs = {
            "org-a": ("https://a.example", "key-a", "model-a"),
            "org-b": ("https://b.example", "key-b", "model-b"),
        }
        mock_settings.get_vision_config.side_effect = lambda slug: configs[slug]

        client_a = MagicMock(name="client_a")
        client_b = MagicMock(name="client_b")
        mock_openai_cls.side_effect = [client_a, client_b]

        client = VisionClient()
        set_active_org("org-a")
        client._get_client()
        # Org B in the same process, even right after org A — must build
        # its own client, not reuse the cached one.
        set_active_org("org-b")
        result = client._get_client()
        assert result is client_b


class TestProcessPagesWithLlmPerOrg:
    @pytest.mark.asyncio
    @patch("app.services.vision.openai_client.settings")
    @patch("app.services.vision.openai_client.AsyncOpenAI")
    async def test_two_orgs_each_build_their_own_chat_client(
        self, mock_openai_cls: MagicMock, mock_settings: MagicMock
    ) -> None:
        configs = {
            "org-a": ("https://a.example", "key-a", "chat-a"),
            "org-b": ("https://b.example", "key-b", "chat-b"),
        }
        mock_settings.get_chat_config.side_effect = lambda slug: configs[slug]

        # Two distinct AsyncOpenAI instances; each one returns a tiny
        # canned chat completion.
        def make_client(label: str) -> MagicMock:
            client = AsyncMock(name=f"client_{label}")
            response = MagicMock()
            response.choices = [MagicMock()]
            response.choices[0].message.content = f"out-{label}"
            response.usage = None
            client.chat.completions.create = AsyncMock(return_value=response)
            return client

        client_a = make_client("a")
        client_b = make_client("b")
        mock_openai_cls.side_effect = [client_a, client_b]

        set_active_org("org-a")
        out_a = await process_pages_with_llm(["hello"], "extract")
        set_active_org("org-b")
        out_b = await process_pages_with_llm(["hello"], "extract")

        assert out_a == ["out-a"]
        assert out_b == ["out-b"]
        # Each org built its own AsyncOpenAI with its own api_key.
        api_keys = [call.kwargs["api_key"] for call in mock_openai_cls.call_args_list]
        assert set(api_keys) == {"key-a", "key-b"}
        assert _chat_states["org-a"].client is client_a
        assert _chat_states["org-b"].client is client_b


class TestLlmCacheOrgIsolation:
    def test_ocr_cache_miss_across_orgs(self) -> None:
        image = b"PNG-like-bytes"
        set_active_org("org-a")
        _, hash_a = llm_cache.get_ocr(image)
        llm_cache.set_ocr(hash_a, "text from A")
        assert llm_cache.get_ocr(image)[0] == "text from A"

        # Same image bytes, different org: must miss.
        set_active_org("org-b")
        cached, hash_b = llm_cache.get_ocr(image)
        assert cached is None
        assert hash_a != hash_b

    def test_description_cache_miss_across_orgs(self) -> None:
        image = b"another-image"
        set_active_org("org-a")
        _, hash_a = llm_cache.get_description(image)
        llm_cache.set_description(hash_a, "desc from A")
        assert llm_cache.get_description(image)[0] == "desc from A"

        set_active_org("org-b")
        cached, _ = llm_cache.get_description(image)
        assert cached is None

    def test_llm_cache_miss_across_orgs(self) -> None:
        set_active_org("org-a")
        llm_cache.set_llm("shared-key", "result A")
        assert llm_cache.get_llm("shared-key") == "result A"

        set_active_org("org-b")
        assert llm_cache.get_llm("shared-key") is None
        llm_cache.set_llm("shared-key", "result B")
        # Org B's value, not org A's.
        assert llm_cache.get_llm("shared-key") == "result B"

        # And org A still sees its own value.
        set_active_org("org-a")
        assert llm_cache.get_llm("shared-key") == "result A"
