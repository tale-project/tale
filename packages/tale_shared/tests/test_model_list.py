"""Tests for model list parsing utilities."""

import pytest

from tale_shared.utils.model_list import (
    get_first_model,
    get_first_model_or_raise,
    parse_model_list,
)


class TestParseModelList:
    def test_none_returns_empty(self):
        assert parse_model_list(None) == []

    def test_empty_string_returns_empty(self):
        assert parse_model_list("") == []

    def test_single_model(self):
        assert parse_model_list("gpt-4") == ["gpt-4"]

    def test_multiple_models(self):
        assert parse_model_list("gpt-4,gpt-3.5-turbo") == ["gpt-4", "gpt-3.5-turbo"]

    def test_strips_whitespace(self):
        assert parse_model_list("  gpt-4 , gpt-3.5-turbo  ") == [
            "gpt-4",
            "gpt-3.5-turbo",
        ]

    def test_skips_empty_entries(self):
        assert parse_model_list("gpt-4,,gpt-3.5-turbo,") == ["gpt-4", "gpt-3.5-turbo"]

    def test_all_empty_entries(self):
        assert parse_model_list(",,,") == []


class TestGetFirstModel:
    def test_none_returns_none(self):
        assert get_first_model(None) is None

    def test_empty_returns_none(self):
        assert get_first_model("") is None

    def test_returns_first(self):
        assert get_first_model("gpt-4,gpt-3.5-turbo") == "gpt-4"

    def test_single_model(self):
        assert get_first_model("gpt-4") == "gpt-4"


class TestGetFirstModelOrRaise:
    def test_returns_first(self):
        assert get_first_model_or_raise("gpt-4,gpt-3.5-turbo", "TEST_VAR") == "gpt-4"

    def test_raises_on_none(self):
        with pytest.raises(ValueError, match="TEST_VAR"):
            get_first_model_or_raise(None, "TEST_VAR")

    def test_raises_on_empty(self):
        with pytest.raises(ValueError, match="MY_MODEL"):
            get_first_model_or_raise("", "MY_MODEL")
