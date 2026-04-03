"""Tests for RAG config settings."""

import os
from unittest.mock import patch

import pytest

from app.config import Settings


def _mock_chat_model():
    return ("https://openrouter.ai/api/v1", "sk-test", "gpt-4o-mini")


def _mock_embedding_model():
    return ("https://openrouter.ai/api/v1", "sk-test", "text-embedding-3-small", 1536)


def _mock_vision_model():
    return ("https://openrouter.ai/api/v1", "sk-test", "gpt-4o")


class TestGetLlmConfig:
    @patch("tale_shared.config.base._provider_embedding_model", return_value=_mock_embedding_model())
    @patch("tale_shared.config.base._provider_chat_model", return_value=_mock_chat_model())
    def test_returns_valid_config(self, mock_chat, mock_embed):
        with patch.dict(os.environ, {}, clear=True):
            s = Settings()
            config = s.get_llm_config()
        assert config["provider"] == "openai"
        assert config["api_key"] == "sk-test"
        assert config["base_url"] == "https://openrouter.ai/api/v1"
        assert config["model"] == "gpt-4o-mini"
        assert config["embedding_model"] == "text-embedding-3-small"

    @patch("tale_shared.config.base._provider_embedding_model", return_value=_mock_embedding_model())
    @patch(
        "tale_shared.config.base._provider_chat_model",
        side_effect=ValueError("No chat model"),
    )
    def test_missing_chat_model_raises(self, mock_chat, mock_embed):
        with patch.dict(os.environ, {}, clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="No chat model"):
                s.get_llm_config()

    @patch(
        "tale_shared.config.base._provider_embedding_model",
        side_effect=ValueError("No embedding model"),
    )
    @patch("tale_shared.config.base._provider_chat_model", return_value=_mock_chat_model())
    def test_missing_embedding_model_raises(self, mock_chat, mock_embed):
        with patch.dict(os.environ, {}, clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="No embedding model"):
                s.get_llm_config()

    @patch("tale_shared.config.base._provider_embedding_model", return_value=_mock_embedding_model())
    @patch("tale_shared.config.base._provider_chat_model", return_value=_mock_chat_model())
    def test_optional_max_tokens_included_when_set(self, mock_chat, mock_embed):
        with patch.dict(os.environ, {"RAG_OPENAI_MAX_TOKENS": "4096"}, clear=True):
            s = Settings()
            config = s.get_llm_config()
        assert config["max_tokens"] == 4096

    @patch("tale_shared.config.base._provider_embedding_model", return_value=_mock_embedding_model())
    @patch("tale_shared.config.base._provider_chat_model", return_value=_mock_chat_model())
    def test_optional_temperature_included_when_set(self, mock_chat, mock_embed):
        with patch.dict(os.environ, {"RAG_OPENAI_TEMPERATURE": "0.7"}, clear=True):
            s = Settings()
            config = s.get_llm_config()
        assert config["temperature"] == pytest.approx(0.7)

    @patch("tale_shared.config.base._provider_embedding_model", return_value=_mock_embedding_model())
    @patch("tale_shared.config.base._provider_chat_model", return_value=_mock_chat_model())
    def test_max_tokens_omitted_when_not_set(self, mock_chat, mock_embed):
        with patch.dict(os.environ, {}, clear=True):
            s = Settings()
            config = s.get_llm_config()
        assert "max_tokens" not in config

    @patch("tale_shared.config.base._provider_embedding_model", return_value=_mock_embedding_model())
    @patch("tale_shared.config.base._provider_chat_model", return_value=_mock_chat_model())
    def test_temperature_omitted_when_not_set(self, mock_chat, mock_embed):
        with patch.dict(os.environ, {}, clear=True):
            s = Settings()
            config = s.get_llm_config()
        assert "temperature" not in config


class TestGetVisionModel:
    @patch("tale_shared.config.base._provider_vision_model", return_value=_mock_vision_model())
    def test_returns_model_from_provider(self, mock_provider):
        with patch.dict(os.environ, {}, clear=True):
            s = Settings()
            assert s.get_vision_model() == "gpt-4o"

    @patch(
        "tale_shared.config.base._provider_vision_model",
        side_effect=ValueError("No vision model"),
    )
    def test_missing_provider_raises(self, mock_provider):
        with patch.dict(os.environ, {}, clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="No vision model"):
                s.get_vision_model()
