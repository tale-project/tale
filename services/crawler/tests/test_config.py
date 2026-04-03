"""Tests for Crawler config settings."""

import os
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from app.config import Settings


def _base_env():
    """Minimum environment variables for a valid Settings (no OPENAI_* needed)."""
    return {}


def _mock_chat_model():
    return ("https://openrouter.ai/api/v1", "sk-test", "gpt-4o-mini")


def _mock_embedding_model():
    return ("https://openrouter.ai/api/v1", "sk-test", "text-embedding-3-small", 1536)


def _mock_vision_model():
    return ("https://openrouter.ai/api/v1", "sk-test", "gpt-4o")


class TestGetFastModel:
    @patch("tale_shared.config.base._provider_chat_model", return_value=_mock_chat_model())
    def test_returns_model_from_provider(self, mock_provider):
        with patch.dict(os.environ, _base_env(), clear=True):
            s = Settings()
            assert s.get_fast_model() == "gpt-4o-mini"

    @patch(
        "tale_shared.config.base._provider_chat_model",
        side_effect=ValueError("No chat model"),
    )
    def test_missing_provider_raises(self, mock_provider):
        with patch.dict(os.environ, _base_env(), clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="No chat model"):
                s.get_fast_model()


class TestGetVisionModel:
    @patch("tale_shared.config.base._provider_vision_model", return_value=_mock_vision_model())
    def test_returns_model_from_provider(self, mock_provider):
        with patch.dict(os.environ, _base_env(), clear=True):
            s = Settings()
            assert s.get_vision_model() == "gpt-4o"

    @patch(
        "tale_shared.config.base._provider_vision_model",
        side_effect=ValueError("No vision model"),
    )
    def test_missing_provider_raises(self, mock_provider):
        with patch.dict(os.environ, _base_env(), clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="No vision model"):
                s.get_vision_model()


class TestGetEmbeddingDimensions:
    @patch("tale_shared.config.base._provider_embedding_model", return_value=_mock_embedding_model())
    def test_returns_dimensions_from_provider(self, mock_provider):
        with patch.dict(os.environ, _base_env(), clear=True):
            s = Settings()
            assert s.get_embedding_dimensions() == 1536

    @patch(
        "tale_shared.config.base._provider_embedding_model",
        return_value=("https://openrouter.ai/api/v1", "sk-test", "embed-model", 3072),
    )
    def test_large_dimensions(self, mock_provider):
        with patch.dict(os.environ, _base_env(), clear=True):
            s = Settings()
            assert s.get_embedding_dimensions() == 3072

    @patch(
        "tale_shared.config.base._provider_embedding_model",
        side_effect=ValueError("No embedding model"),
    )
    def test_missing_provider_raises(self, mock_provider):
        with patch.dict(os.environ, _base_env(), clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="No embedding model"):
                s.get_embedding_dimensions()


class TestFrequencyDefaults:
    def test_conservative_defaults(self):
        with patch.dict(os.environ, _base_env(), clear=True):
            s = Settings()
            assert s.poll_interval == 300
            assert s.max_concurrent_scans == 1
            assert s.crawl_batch_size == 5
            assert s.crawl_count_before_restart == 25
            assert s.db_pool_max_size == 10

    def test_env_var_override(self):
        env = _base_env()
        env["CRAWLER_POLL_INTERVAL"] = "60"
        env["CRAWLER_MAX_CONCURRENT_SCANS"] = "4"
        env["CRAWLER_CRAWL_BATCH_SIZE"] = "20"
        env["CRAWLER_CRAWL_COUNT_BEFORE_RESTART"] = "100"
        env["CRAWLER_DB_POOL_MAX_SIZE"] = "25"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.poll_interval == 60
            assert s.max_concurrent_scans == 4
            assert s.crawl_batch_size == 20
            assert s.crawl_count_before_restart == 100
            assert s.db_pool_max_size == 25

    def test_rejects_zero_poll_interval(self):
        env = _base_env()
        env["CRAWLER_POLL_INTERVAL"] = "0"
        with patch.dict(os.environ, env, clear=True), pytest.raises(ValidationError):
            Settings()

    def test_rejects_zero_max_concurrent_scans(self):
        env = _base_env()
        env["CRAWLER_MAX_CONCURRENT_SCANS"] = "0"
        with patch.dict(os.environ, env, clear=True), pytest.raises(ValidationError):
            Settings()

    def test_rejects_pool_size_below_minimum(self):
        env = _base_env()
        env["CRAWLER_DB_POOL_MAX_SIZE"] = "1"
        with patch.dict(os.environ, env, clear=True), pytest.raises(ValidationError):
            Settings()

    def test_dead_settings_removed(self):
        with patch.dict(os.environ, _base_env(), clear=True):
            s = Settings()
            assert not hasattr(s, "max_concurrent_crawls")
            assert not hasattr(s, "default_max_pages")
            assert not hasattr(s, "default_word_count_threshold")
            assert not hasattr(s, "default_concurrency")
            assert not hasattr(s, "request_timeout_seconds")
