"""Tests for Crawler config model list parsing."""

import os
from unittest.mock import patch

import pytest

from app.config import Settings


def _base_env():
    """Minimum environment variables for a valid Settings."""
    return {
        "OPENAI_API_KEY": "sk-test",
        "OPENAI_BASE_URL": "https://api.openai.com/v1",
    }


class TestGetFastModelParsing:
    def test_single_model_returned_as_is(self):
        env = _base_env()
        env["OPENAI_FAST_MODEL"] = "gpt-4o-mini"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.get_fast_model() == "gpt-4o-mini"

    def test_comma_separated_returns_first_model(self):
        env = _base_env()
        env["OPENAI_FAST_MODEL"] = "gpt-4o-mini, gpt-4o, o1-mini"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.get_fast_model() == "gpt-4o-mini"

    def test_crawler_prefixed_takes_priority(self):
        env = _base_env()
        env["CRAWLER_OPENAI_FAST_MODEL"] = "crawler-model, fallback"
        env["OPENAI_FAST_MODEL"] = "generic-model"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.get_fast_model() == "crawler-model"

    def test_falls_back_to_generic_env(self):
        env = _base_env()
        env["OPENAI_FAST_MODEL"] = "generic-fast, other"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.get_fast_model() == "generic-fast"

    def test_missing_model_raises(self):
        env = _base_env()
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="OPENAI_FAST_MODEL"):
                s.get_fast_model()


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

    def test_crawler_prefixed_vision_model_takes_priority(self):
        env = _base_env()
        env["CRAWLER_OPENAI_VISION_MODEL"] = "crawler-vision, fallback"
        env["OPENAI_VISION_MODEL"] = "generic-vision"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.get_vision_model() == "crawler-vision"

    def test_missing_vision_model_raises(self):
        env = _base_env()
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="OPENAI_VISION_MODEL"):
                s.get_vision_model()


class TestGetEmbeddingDimensions:
    def test_crawler_prefixed_takes_priority(self):
        env = _base_env()
        env["CRAWLER_EMBEDDING_DIMENSIONS"] = "768"
        env["EMBEDDING_DIMENSIONS"] = "1536"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.get_embedding_dimensions() == 768

    def test_falls_back_to_generic_env(self):
        env = _base_env()
        env["EMBEDDING_DIMENSIONS"] = "1536"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.get_embedding_dimensions() == 1536

    def test_missing_dimensions_raises(self):
        env = _base_env()
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="EMBEDDING_DIMENSIONS"):
                s.get_embedding_dimensions()
