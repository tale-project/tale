"""Tests for document router helpers and config settings.

Covers:
- _validate_file_extension: supported, unsupported, no extension
- _parse_metadata: valid JSON, invalid JSON, non-dict JSON, None
- SUPPORTED_EXTENSIONS: excludes legacy Office formats (.doc, .ppt, .xls)
- Settings.get_embedding_dimensions(): via provider files
- Settings.get_llm_config(): via provider files
"""

import os
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.config import Settings
from app.routers.documents import (
    SUPPORTED_EXTENSIONS,
    _parse_metadata,
    _validate_file_extension,
)


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


def _mock_chat_model():
    return ("https://openrouter.ai/api/v1", "sk-test", "gpt-4o-mini")


def _mock_embedding_model():
    return ("https://openrouter.ai/api/v1", "sk-test", "text-embedding-3-small", 1536)


class TestGetEmbeddingDimensions:
    """Settings.get_embedding_dimensions() from provider files."""

    @patch("tale_shared.config.base._provider_embedding_model", return_value=_mock_embedding_model())
    def test_valid_dimensions(self, mock_provider):
        with patch.dict(os.environ, {}, clear=True):
            s = Settings()
            assert s.get_embedding_dimensions() == 1536

    @patch(
        "tale_shared.config.base._provider_embedding_model",
        return_value=("https://openrouter.ai/api/v1", "sk-test", "embed-large", 3072),
    )
    def test_large_dimensions(self, mock_provider):
        with patch.dict(os.environ, {}, clear=True):
            s = Settings()
            assert s.get_embedding_dimensions() == 3072

    @patch(
        "tale_shared.config.base._provider_embedding_model",
        side_effect=ValueError("No embedding model"),
    )
    def test_missing_provider_raises(self, mock_provider):
        with patch.dict(os.environ, {}, clear=True):
            s = Settings()
            with pytest.raises(ValueError, match="No embedding model"):
                s.get_embedding_dimensions()


class TestGetLlmConfig:
    """Settings.get_llm_config() from provider files."""

    @patch("tale_shared.config.base._provider_embedding_model", return_value=_mock_embedding_model())
    @patch("tale_shared.config.base._provider_chat_model", return_value=_mock_chat_model())
    def test_all_present_returns_valid_config(self, mock_chat, mock_embed):
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
