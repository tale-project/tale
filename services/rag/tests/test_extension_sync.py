"""Cross-check that Python SUPPORTED_EXTENSIONS stays in sync with TypeScript file-types."""

import ast
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent

PYTHON_SOURCE = REPO_ROOT / "services" / "rag" / "app" / "routers" / "documents.py"
TS_TEXT_FILE_TYPES = REPO_ROOT / "services" / "platform" / "lib" / "utils" / "text-file-types.ts"
TS_FILE_TYPES = REPO_ROOT / "services" / "platform" / "lib" / "shared" / "file-types.ts"

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".webp"}


def _parse_python_supported_extensions() -> set[str]:
    source = PYTHON_SOURCE.read_text()
    match = re.search(
        r"SUPPORTED_EXTENSIONS\s*=\s*\{([^}]+)\}",
        source,
        re.DOTALL,
    )
    assert match, "Could not find SUPPORTED_EXTENSIONS in documents.py"
    raw_block = match.group(1)
    without_comments = re.sub(r"#[^\n]*", "", raw_block)
    return set(ast.literal_eval(f"[{without_comments}]"))


def _parse_ts_set_literal(source: str, variable_name: str) -> set[str]:
    pattern = rf"(?:const|export const)\s+{variable_name}\s*=\s*new\s+Set\(\[\s*(.*?)\]\)"
    match = re.search(pattern, source, re.DOTALL)
    if not match:
        return set()
    raw = match.group(1)
    return set(re.findall(r"'([^']+)'", raw))


def _parse_ts_text_file_extensions() -> set[str]:
    source = TS_TEXT_FILE_TYPES.read_text()
    code = _parse_ts_set_literal(source, "CODE_EXTENSIONS")
    config = _parse_ts_set_literal(source, "CONFIG_EXTENSIONS")
    markup = _parse_ts_set_literal(source, "MARKUP_EXTENSIONS")
    data = _parse_ts_set_literal(source, "DATA_EXTENSIONS")
    text = _parse_ts_set_literal(source, "TEXT_EXTENSIONS")
    return code | config | markup | data | text


def _parse_ts_document_upload_extensions() -> set[str]:
    source = TS_FILE_TYPES.read_text()
    match = re.search(r"DOCUMENT_UPLOAD_ACCEPT\s*=\s*\[(.*?)\]\.join", source, re.DOTALL)
    if not match:
        return set()
    raw = match.group(1)
    extensions: set[str] = set()
    for token in re.findall(r"'([^']+)'", raw):
        for part in token.split(","):
            part = part.strip()
            if part.startswith("."):
                extensions.add(part.lstrip("."))
    return extensions


def _build_typescript_extensions() -> set[str]:
    text_file_exts = _parse_ts_text_file_extensions()
    doc_upload_exts = _parse_ts_document_upload_extensions()
    return {f".{ext}" for ext in text_file_exts | doc_upload_exts}


class TestExtensionSync:
    def test_python_is_subset_of_typescript(self):
        python_exts = _parse_python_supported_extensions()
        ts_exts = _build_typescript_extensions()

        non_image_python = python_exts - IMAGE_EXTENSIONS
        missing = non_image_python - ts_exts

        assert not missing, (
            f"Python SUPPORTED_EXTENSIONS has {len(missing)} extension(s) "
            f"not found in TypeScript: {sorted(missing)}"
        )

    def test_image_extensions_covered_by_wildcard(self):
        source = TS_TEXT_FILE_TYPES.read_text()
        assert "'image/*'" in source or '"image/*"' in source or (
            "image/*" in TS_FILE_TYPES.read_text()
        ), "TypeScript TEXT_FILE_ACCEPT should include image/* wildcard"

        python_exts = _parse_python_supported_extensions()
        python_images = python_exts & IMAGE_EXTENSIONS
        assert python_images, "Python SUPPORTED_EXTENSIONS should contain image extensions"

    def test_parsers_return_nonempty(self):
        python_exts = _parse_python_supported_extensions()
        ts_exts = _build_typescript_extensions()

        assert len(python_exts) > 0, "Failed to parse any Python extensions"
        assert len(ts_exts) > 0, "Failed to parse any TypeScript extensions"

    def test_source_files_exist(self):
        assert PYTHON_SOURCE.exists(), f"Missing {PYTHON_SOURCE}"
        assert TS_TEXT_FILE_TYPES.exists(), f"Missing {TS_TEXT_FILE_TYPES}"
        assert TS_FILE_TYPES.exists(), f"Missing {TS_FILE_TYPES}"
