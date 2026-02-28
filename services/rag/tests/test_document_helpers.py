"""Tests for document router helpers and config settings.

Covers:
- _parse_team_ids: None, empty, valid, invalid, required=True/False
- _validate_file_extension: supported, unsupported, no extension
- _parse_metadata: valid JSON, invalid JSON, non-dict JSON, None
- SUPPORTED_EXTENSIONS: excludes legacy Office formats (.doc, .ppt, .xls)
- Settings.get_embedding_dimensions(): valid, missing, invalid
- Settings.get_llm_config(): missing required keys raise ValueError
"""

import os
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.config import Settings
from app.routers.documents import (
    SUPPORTED_EXTENSIONS,
    _parse_metadata,
    _parse_team_ids,
    _validate_file_extension,
)


class TestParseTeamIds:
    """Parse and sanitize comma-separated team IDs."""

    def test_none_not_required_returns_none(self):
        assert _parse_team_ids(None, required=False) is None

    def test_empty_string_not_required_returns_none(self):
        assert _parse_team_ids("", required=False) is None

    def test_none_required_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            _parse_team_ids(None, required=True)
        assert exc_info.value.status_code == 400
        assert "team_id" in exc_info.value.detail

    def test_empty_string_required_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            _parse_team_ids("", required=True)
        assert exc_info.value.status_code == 400

    def test_single_valid_team_id(self):
        result = _parse_team_ids("team-abc")
        assert result == ["team-abc"]

    def test_multiple_valid_team_ids(self):
        result = _parse_team_ids("team-1,team-2,team-3")
        assert result == ["team-1", "team-2", "team-3"]

    def test_strips_whitespace_around_ids(self):
        result = _parse_team_ids(" team-1 , team-2 ")
        assert result == ["team-1", "team-2"]

    def test_skips_empty_segments(self):
        result = _parse_team_ids("team-1,,team-2,")
        assert result == ["team-1", "team-2"]

    def test_all_invalid_ids_not_required_returns_none(self):
        result = _parse_team_ids("!!!,@@@,###", required=False)
        assert result is None

    def test_all_invalid_ids_required_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            _parse_team_ids("!!!,@@@,###", required=True)
        assert exc_info.value.status_code == 400

    def test_mixed_valid_and_invalid_ids_keeps_sanitizable(self):
        result = _parse_team_ids("valid-team,@@@,another-ok")
        assert "valid-team" in result
        assert "another-ok" in result
        assert len(result) == 2

    def test_special_chars_stripped_from_ids(self):
        result = _parse_team_ids("!!wrapped!!,clean-id")
        assert result is not None
        assert "wrapped" in result
        assert "clean-id" in result

    def test_sanitizes_dots_and_spaces(self):
        result = _parse_team_ids("team.name with spaces")
        assert result is not None
        assert len(result) == 1
        sanitized = result[0]
        assert "." not in sanitized
        assert " " not in sanitized

    def test_default_required_is_false(self):
        assert _parse_team_ids(None) is None


class TestValidateFileExtension:
    """Validate file extension against SUPPORTED_EXTENSIONS."""

    def test_supported_pdf(self):
        ext = _validate_file_extension("document.pdf")
        assert ext == ".pdf"

    def test_supported_txt(self):
        ext = _validate_file_extension("notes.txt")
        assert ext == ".txt"

    def test_supported_docx(self):
        ext = _validate_file_extension("report.docx")
        assert ext == ".docx"

    def test_supported_py(self):
        ext = _validate_file_extension("script.py")
        assert ext == ".py"

    def test_supported_png(self):
        ext = _validate_file_extension("image.png")
        assert ext == ".png"

    def test_case_insensitive(self):
        ext = _validate_file_extension("document.PDF")
        assert ext == ".pdf"

    def test_mixed_case(self):
        ext = _validate_file_extension("report.Docx")
        assert ext == ".docx"

    def test_no_extension_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_file_extension("noextension")
        assert exc_info.value.status_code == 400
        assert "extension" in exc_info.value.detail.lower()

    def test_unsupported_exe_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_file_extension("program.exe")
        assert exc_info.value.status_code == 400
        assert ".exe" in exc_info.value.detail

    def test_unsupported_zip_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_file_extension("archive.zip")
        assert exc_info.value.status_code == 400
        assert ".zip" in exc_info.value.detail

    def test_unsupported_doc_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_file_extension("legacy.doc")
        assert exc_info.value.status_code == 400
        assert ".doc" in exc_info.value.detail

    def test_path_with_directories(self):
        ext = _validate_file_extension("path/to/file.md")
        assert ext == ".md"

    def test_dotfile_has_no_extension(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_file_extension(".env")
        assert exc_info.value.status_code == 400
        assert "extension" in exc_info.value.detail.lower()


class TestParseMetadata:
    """Parse optional JSON metadata string."""

    def test_none_returns_empty_dict(self):
        assert _parse_metadata(None) == {}

    def test_empty_string_returns_empty_dict(self):
        assert _parse_metadata("") == {}

    def test_valid_json_object(self):
        result = _parse_metadata('{"key": "value", "count": 42}')
        assert result == {"key": "value", "count": 42}

    def test_empty_json_object(self):
        result = _parse_metadata("{}")
        assert result == {}

    def test_nested_json_object(self):
        result = _parse_metadata('{"outer": {"inner": true}}')
        assert result == {"outer": {"inner": True}}

    def test_invalid_json_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            _parse_metadata("{not valid json}")
        assert exc_info.value.status_code == 400
        assert "Invalid metadata" in exc_info.value.detail

    def test_json_array_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            _parse_metadata("[1, 2, 3]")
        assert exc_info.value.status_code == 400
        assert "JSON object" in exc_info.value.detail

    def test_json_string_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            _parse_metadata('"just a string"')
        assert exc_info.value.status_code == 400
        assert "JSON object" in exc_info.value.detail

    def test_json_number_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            _parse_metadata("42")
        assert exc_info.value.status_code == 400
        assert "JSON object" in exc_info.value.detail

    def test_json_boolean_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            _parse_metadata("true")
        assert exc_info.value.status_code == 400
        assert "JSON object" in exc_info.value.detail

    def test_json_null_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            _parse_metadata("null")
        assert exc_info.value.status_code == 400
        assert "JSON object" in exc_info.value.detail


class TestSupportedExtensions:
    """SUPPORTED_EXTENSIONS must not include legacy Office formats."""

    def test_doc_not_supported(self):
        assert ".doc" not in SUPPORTED_EXTENSIONS

    def test_ppt_not_supported(self):
        assert ".ppt" not in SUPPORTED_EXTENSIONS

    def test_xls_not_supported(self):
        assert ".xls" not in SUPPORTED_EXTENSIONS

    def test_env_not_supported(self):
        assert ".env" not in SUPPORTED_EXTENSIONS

    def test_log_not_supported(self):
        assert ".log" not in SUPPORTED_EXTENSIONS

    def test_modern_office_formats_supported(self):
        assert ".docx" in SUPPORTED_EXTENSIONS
        assert ".pptx" in SUPPORTED_EXTENSIONS
        assert ".xlsx" in SUPPORTED_EXTENSIONS

    def test_common_text_formats_supported(self):
        assert ".txt" in SUPPORTED_EXTENSIONS
        assert ".md" in SUPPORTED_EXTENSIONS
        assert ".csv" in SUPPORTED_EXTENSIONS
        assert ".json" in SUPPORTED_EXTENSIONS

    def test_common_code_formats_supported(self):
        assert ".py" in SUPPORTED_EXTENSIONS
        assert ".js" in SUPPORTED_EXTENSIONS
        assert ".ts" in SUPPORTED_EXTENSIONS
        assert ".rs" in SUPPORTED_EXTENSIONS
        assert ".go" in SUPPORTED_EXTENSIONS

    def test_image_formats_supported(self):
        assert ".png" in SUPPORTED_EXTENSIONS
        assert ".jpg" in SUPPORTED_EXTENSIONS
        assert ".jpeg" in SUPPORTED_EXTENSIONS
        assert ".gif" in SUPPORTED_EXTENSIONS
        assert ".webp" in SUPPORTED_EXTENSIONS

    def test_extensions_are_lowercase_with_dot_prefix(self):
        for ext in SUPPORTED_EXTENSIONS:
            assert ext.startswith("."), f"{ext} must start with a dot"
            assert ext == ext.lower(), f"{ext} must be lowercase"


def _base_env():
    """Minimum valid environment for Settings + get_llm_config."""
    return {
        "OPENAI_API_KEY": "sk-test",
        "OPENAI_BASE_URL": "https://api.openai.com/v1",
        "OPENAI_FAST_MODEL": "gpt-4o-mini",
        "OPENAI_EMBEDDING_MODEL": "text-embedding-3-small",
        "EMBEDDING_DIMENSIONS": "1536",
    }


class TestGetEmbeddingDimensions:
    """Settings.get_embedding_dimensions() parsing and validation."""

    def test_valid_dimensions(self):
        env = _base_env()
        env["EMBEDDING_DIMENSIONS"] = "1536"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.get_embedding_dimensions() == 1536

    def test_large_dimensions(self):
        env = _base_env()
        env["EMBEDDING_DIMENSIONS"] = "3072"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            assert s.get_embedding_dimensions() == 3072

    def test_missing_dimensions_raises(self):
        env = _base_env()
        del env["EMBEDDING_DIMENSIONS"]
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="EMBEDDING_DIMENSIONS must be set"):
                s.get_embedding_dimensions()

    def test_non_numeric_dimensions_raises(self):
        env = _base_env()
        env["EMBEDDING_DIMENSIONS"] = "not_a_number"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="valid positive integer"):
                s.get_embedding_dimensions()

    def test_zero_dimensions_raises(self):
        env = _base_env()
        env["EMBEDDING_DIMENSIONS"] = "0"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="positive integer"):
                s.get_embedding_dimensions()

    def test_negative_dimensions_raises(self):
        env = _base_env()
        env["EMBEDDING_DIMENSIONS"] = "-100"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="positive integer"):
                s.get_embedding_dimensions()

    def test_float_dimensions_raises(self):
        env = _base_env()
        env["EMBEDDING_DIMENSIONS"] = "1536.5"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="valid positive integer"):
                s.get_embedding_dimensions()

    def test_empty_string_dimensions_raises(self):
        env = _base_env()
        env["EMBEDDING_DIMENSIONS"] = ""
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="EMBEDDING_DIMENSIONS"):
                s.get_embedding_dimensions()


class TestGetLlmConfigMissingKeys:
    """Settings.get_llm_config() must raise ValueError for missing required keys."""

    def test_missing_api_key_raises(self):
        env = _base_env()
        del env["OPENAI_API_KEY"]
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="OPENAI_API_KEY"):
                s.get_llm_config()

    def test_missing_base_url_raises(self):
        env = _base_env()
        del env["OPENAI_BASE_URL"]
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="OPENAI_BASE_URL"):
                s.get_llm_config()

    def test_missing_fast_model_raises(self):
        env = _base_env()
        del env["OPENAI_FAST_MODEL"]
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="OPENAI_FAST_MODEL"):
                s.get_llm_config()

    def test_missing_embedding_model_raises(self):
        env = _base_env()
        del env["OPENAI_EMBEDDING_MODEL"]
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="OPENAI_EMBEDDING_MODEL"):
                s.get_llm_config()

    def test_all_present_returns_valid_config(self):
        env = _base_env()
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            config = s.get_llm_config()
        assert config["provider"] == "openai"
        assert config["api_key"] == "sk-test"
        assert config["base_url"] == "https://api.openai.com/v1"
        assert config["model"] == "gpt-4o-mini"
        assert config["embedding_model"] == "text-embedding-3-small"

    def test_optional_max_tokens_included_when_set(self):
        env = _base_env()
        env["OPENAI_MAX_TOKENS"] = "4096"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            config = s.get_llm_config()
        assert config["max_tokens"] == 4096

    def test_optional_temperature_included_when_set(self):
        env = _base_env()
        env["OPENAI_TEMPERATURE"] = "0.7"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            config = s.get_llm_config()
        assert config["temperature"] == pytest.approx(0.7)

    def test_max_tokens_omitted_when_not_set(self):
        env = _base_env()
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            config = s.get_llm_config()
        assert "max_tokens" not in config

    def test_temperature_omitted_when_not_set(self):
        env = _base_env()
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            config = s.get_llm_config()
        assert "temperature" not in config

    def test_rag_prefixed_api_key_takes_priority(self):
        env = _base_env()
        env["RAG_OPENAI_API_KEY"] = "sk-rag-specific"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            config = s.get_llm_config()
        assert config["api_key"] == "sk-rag-specific"

    def test_rag_prefixed_base_url_takes_priority(self):
        env = _base_env()
        env["RAG_OPENAI_BASE_URL"] = "https://rag.api.example.com"
        with patch.dict(os.environ, env, clear=True):
            s = Settings()
            config = s.get_llm_config()
        assert config["base_url"] == "https://rag.api.example.com"
