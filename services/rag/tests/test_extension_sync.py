"""Cross-check that the RAG upload allowlist stays in sync with TypeScript file-types.

Two directions are enforced:

- Forward: every extension RAG accepts is uploadable from the platform
  (Python ⊆ TypeScript chat/document accept surface).
- Reverse: the platform's RAG_INDEXABLE_EXTENSIONS gate (which decides what
  gets queued for indexing) equals RAG's SUPPORTED_EXTENSIONS exactly, so the
  platform never force-queues a format RAG rejects with HTTP 400.
"""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent

TS_TEXT_FILE_TYPES = REPO_ROOT / "services" / "platform" / "lib" / "utils" / "text-file-types.ts"
TS_FILE_TYPES = REPO_ROOT / "services" / "platform" / "lib" / "shared" / "file-types.ts"

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif", ".webp"}


def _python_supported_extensions() -> set[str]:
    from app.routers.documents import SUPPORTED_EXTENSIONS

    return set(SUPPORTED_EXTENSIONS)


def _parse_ts_set_literal(source: str, variable_name: str) -> set[str]:
    pattern = (
        rf"(?:const|export const)\s+{variable_name}"
        rf"(?:\s*:\s*[\w<>\[\], .]+)?\s*=\s*new\s+Set\(\[\s*(.*?)\]\)"
    )
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


def _parse_ts_rag_indexable_extensions() -> set[str]:
    source = TS_FILE_TYPES.read_text()
    return {f".{ext}" for ext in _parse_ts_set_literal(source, "RAG_INDEXABLE_EXTENSIONS")}


def _build_typescript_extensions() -> set[str]:
    text_file_exts = _parse_ts_text_file_extensions()
    doc_upload_exts = _parse_ts_document_upload_extensions()
    return {f".{ext}" for ext in text_file_exts | doc_upload_exts}


class TestExtensionSync:
    def test_python_is_subset_of_typescript(self):
        python_exts = _python_supported_extensions()
        ts_exts = _build_typescript_extensions()

        non_image_python = python_exts - IMAGE_EXTENSIONS
        missing = non_image_python - ts_exts

        assert not missing, (
            f"Python SUPPORTED_EXTENSIONS has {len(missing)} extension(s) not found in TypeScript: {sorted(missing)}"
        )

    def test_rag_indexable_extensions_match_python(self):
        """Reverse parity: the platform's indexability gate equals RAG's allowlist.

        A platform-only extension would be force-queued and rejected by RAG
        (HTTP 400 → permanent "Index failed"); a RAG-only extension would
        never be queued and silently skip indexing.
        """
        ts_exts = _parse_ts_rag_indexable_extensions()
        python_exts = _python_supported_extensions()

        only_ts = ts_exts - python_exts
        only_python = python_exts - ts_exts

        assert ts_exts == python_exts, (
            f"RAG_INDEXABLE_EXTENSIONS (file-types.ts) and SUPPORTED_EXTENSIONS "
            f"(app/routers/documents.py) drifted. Only in TypeScript: "
            f"{sorted(only_ts)}; only in Python: {sorted(only_python)}"
        )

    def test_image_extensions_covered_by_wildcard(self):
        source = TS_TEXT_FILE_TYPES.read_text()
        assert "'image/*'" in source or '"image/*"' in source or ("image/*" in TS_FILE_TYPES.read_text()), (
            "TypeScript TEXT_FILE_ACCEPT should include image/* wildcard"
        )

        python_exts = _python_supported_extensions()
        python_images = python_exts & IMAGE_EXTENSIONS
        assert python_images, "Python SUPPORTED_EXTENSIONS should contain image extensions"

    def test_parsers_return_nonempty(self):
        python_exts = _python_supported_extensions()
        ts_exts = _build_typescript_extensions()
        rag_indexable_exts = _parse_ts_rag_indexable_extensions()

        assert len(python_exts) > 0, "Failed to load any Python extensions"
        assert len(ts_exts) > 0, "Failed to parse any TypeScript extensions"
        assert len(rag_indexable_exts) > 0, "Failed to parse RAG_INDEXABLE_EXTENSIONS"

    def test_source_files_exist(self):
        assert TS_TEXT_FILE_TYPES.exists(), f"Missing {TS_TEXT_FILE_TYPES}"
        assert TS_FILE_TYPES.exists(), f"Missing {TS_FILE_TYPES}"
