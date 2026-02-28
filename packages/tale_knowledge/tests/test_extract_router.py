"""Tests for file extraction router."""

import pytest

from tale_knowledge.extraction.router import (
    ALL_SUPPORTED_EXTENSIONS,
    is_supported,
)


class TestIsSupported:
    def test_pdf(self):
        assert is_supported("document.pdf")

    def test_docx(self):
        assert is_supported("document.docx")

    def test_pptx(self):
        assert is_supported("slides.pptx")

    def test_xlsx(self):
        assert is_supported("data.xlsx")

    def test_images(self):
        assert is_supported("photo.png")
        assert is_supported("photo.jpg")
        assert is_supported("photo.jpeg")
        assert is_supported("photo.gif")
        assert is_supported("photo.webp")

    def test_text_formats(self):
        assert is_supported("readme.md")
        assert is_supported("notes.txt")
        assert is_supported("data.csv")

    def test_unsupported(self):
        assert not is_supported("archive.zip")
        assert not is_supported("video.mp4")
        assert not is_supported("binary.exe")

    def test_case_insensitive(self):
        assert is_supported("Document.PDF")
        assert is_supported("Image.PNG")


class TestExtractText:
    @pytest.mark.asyncio
    async def test_text_file(self):
        from tale_knowledge.extraction.router import extract_text

        content = (
            b"Hello, this is a test document with enough content to be meaningful."
        )
        text, vision_used = await extract_text(content, "test.txt")
        assert text == content.decode("utf-8")
        assert vision_used is False

    @pytest.mark.asyncio
    async def test_markdown_file(self):
        from tale_knowledge.extraction.router import extract_text

        content = b"# Title\n\nSome markdown content"
        text, vision_used = await extract_text(content, "readme.md")
        assert "# Title" in text
        assert vision_used is False

    @pytest.mark.asyncio
    async def test_unsupported_raises(self):
        from tale_knowledge.extraction.router import extract_text

        with pytest.raises(ValueError, match="Unsupported file type"):
            await extract_text(b"data", "archive.zip")

    def test_all_supported_extensions_complete(self):
        assert ".pdf" in ALL_SUPPORTED_EXTENSIONS
        assert ".docx" in ALL_SUPPORTED_EXTENSIONS
        assert ".pptx" in ALL_SUPPORTED_EXTENSIONS
        assert ".xlsx" in ALL_SUPPORTED_EXTENSIONS
        assert ".png" in ALL_SUPPORTED_EXTENSIONS
        assert ".txt" in ALL_SUPPORTED_EXTENSIONS
        assert ".md" in ALL_SUPPORTED_EXTENSIONS
        assert ".csv" in ALL_SUPPORTED_EXTENSIONS
