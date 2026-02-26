"""Tests for Operator config model list parsing."""

import os
from unittest.mock import patch

from app.config import Settings


def _base_env():
    """Minimum environment variables for a valid Operator Settings."""
    return {
        "OPENAI_API_KEY": "sk-test",
        "OPENAI_BASE_URL": "https://api.openai.com/v1",
        "OPENAI_MODEL": "gpt-4o",
    }


class TestLlmModelParsing:
    def test_single_model_returned_as_is(self):
        env = _base_env()
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.llm_model == "gpt-4o"

    def test_comma_separated_returns_first_model(self):
        env = _base_env()
        env["OPENAI_MODEL"] = "gpt-4o, o1-mini, gpt-4o-mini"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.llm_model == "gpt-4o"


class TestLlmFastModelParsing:
    def test_single_fast_model(self):
        env = _base_env()
        env["OPENAI_FAST_MODEL"] = "gpt-4o-mini"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.llm_fast_model == "gpt-4o-mini"

    def test_comma_separated_fast_model_returns_first(self):
        env = _base_env()
        env["OPENAI_FAST_MODEL"] = "gpt-4o-mini, o1-mini"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.llm_fast_model == "gpt-4o-mini"

    def test_falls_back_to_llm_model_when_fast_not_set(self):
        env = _base_env()
        env["OPENAI_MODEL"] = "gpt-4o, fallback"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.llm_fast_model == "gpt-4o"


class TestLlmVisionModelParsing:
    def test_single_vision_model(self):
        env = _base_env()
        env["OPENAI_VISION_MODEL"] = "gpt-4o"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.llm_vision_model == "gpt-4o"

    def test_comma_separated_vision_model_returns_first(self):
        env = _base_env()
        env["OPENAI_VISION_MODEL"] = "gpt-4o, gpt-4o-mini"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.llm_vision_model == "gpt-4o"

    def test_returns_none_when_not_set(self):
        env = _base_env()
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.llm_vision_model is None
