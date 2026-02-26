"""Tests for RAG config model list parsing."""

import os
from unittest.mock import patch

import pytest

from app.config import Settings


def _base_env():
    """Minimum environment variables for a valid Settings + get_llm_config."""
    return {
        "OPENAI_API_KEY": "sk-test",
        "OPENAI_BASE_URL": "https://api.openai.com/v1",
        "OPENAI_FAST_MODEL": "gpt-4o-mini",
        "OPENAI_EMBEDDING_MODEL": "text-embedding-3-small",
        "EMBEDDING_DIMENSIONS": "1536",
    }


class TestGetLlmConfigModelParsing:
    def test_single_model_returned_as_is(self):
        env = _base_env()
        env["OPENAI_FAST_MODEL"] = "gpt-4o-mini"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            config = s.get_llm_config()
        assert config["model"] == "gpt-4o-mini"

    def test_comma_separated_returns_first_model(self):
        env = _base_env()
        env["OPENAI_FAST_MODEL"] = "gpt-4o-mini, gpt-4o, o1-mini"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            config = s.get_llm_config()
        assert config["model"] == "gpt-4o-mini"

    def test_missing_model_raises(self):
        env = _base_env()
        del env["OPENAI_FAST_MODEL"]
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="OPENAI_FAST_MODEL"):
                s.get_llm_config()


class TestGetVisionModelParsing:
    def test_single_vision_model(self):
        env = _base_env()
        env["OPENAI_VISION_MODEL"] = "gpt-4o"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.get_vision_model() == "gpt-4o"

    def test_comma_separated_vision_model_returns_first(self):
        env = _base_env()
        env["OPENAI_VISION_MODEL"] = "gpt-4o, gpt-4o-mini"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.get_vision_model() == "gpt-4o"

    def test_rag_prefixed_vision_model_takes_priority(self):
        env = _base_env()
        env["RAG_OPENAI_VISION_MODEL"] = "rag-vision-model, fallback"
        env["OPENAI_VISION_MODEL"] = "generic-vision"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.get_vision_model() == "rag-vision-model"

    def test_falls_back_to_generic_env_when_rag_prefix_missing(self):
        env = _base_env()
        env["OPENAI_VISION_MODEL"] = "generic-vision, other"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.get_vision_model() == "generic-vision"

    def test_missing_vision_model_raises(self):
        env = _base_env()
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="OPENAI_VISION_MODEL"):
                s.get_vision_model()
