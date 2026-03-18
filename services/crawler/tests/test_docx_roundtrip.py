"""Tests for DOCX round-trip extraction and application."""

from io import BytesIO

import pytest
from docx import Document
from docx.oxml.ns import qn
from lxml import etree

from app.services.docx_roundtrip_service import DocxRoundtripService


def _make_docx(*paragraphs: str, bold_first_run: bool = False) -> bytes:
    """Create a simple DOCX with the given paragraph texts."""
    doc = Document()
    for text in paragraphs:
        para = doc.add_paragraph()
        run = para.add_run(text)
        if bold_first_run:
            run.bold = True
    buf = BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _make_docx_with_bookmark(text: str, bookmark_name: str = "BM1") -> bytes:
    """Create a DOCX with a paragraph containing a bookmark around the text."""
    doc = Document()
    para = doc.add_paragraph()
    p_elem = para._element

    # Add bookmarkStart before run
    bm_start = etree.SubElement(p_elem, qn("w:bookmarkStart"))
    bm_start.set(qn("w:id"), "1")
    bm_start.set(qn("w:name"), bookmark_name)

    run = para.add_run(text)

    # Add bookmarkEnd after run
    bm_end = etree.SubElement(p_elem, qn("w:bookmarkEnd"))
    bm_end.set(qn("w:id"), "1")

    buf = BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _make_docx_with_hyperlink() -> bytes:
    """Create a DOCX with a paragraph containing a hyperlink element."""
    doc = Document()
    para = doc.add_paragraph()
    p_elem = para._element

    # Add a normal run
    run = para.add_run("Click ")

    # Add hyperlink element
    hyperlink = etree.SubElement(p_elem, qn("w:hyperlink"))
    hyperlink.set(qn("r:id"), "rId1")
    h_run = etree.SubElement(hyperlink, qn("w:r"))
    h_text = etree.SubElement(h_run, qn("w:t"))
    h_text.text = "here"

    buf = BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _make_docx_with_table() -> bytes:
    """Create a DOCX with a table."""
    doc = Document()
    doc.add_paragraph("Before table")
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "A1"
    table.cell(0, 1).text = "B1"
    table.cell(1, 0).text = "A2"
    table.cell(1, 1).text = "B2"
    doc.add_paragraph("After table")
    buf = BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _make_docx_with_drawing() -> bytes:
    """Create a DOCX with a run containing a w:drawing element."""
    doc = Document()
    para = doc.add_paragraph()
    run = para.add_run("Image: ")

    # Add a fake drawing element to the run
    drawing = etree.SubElement(run._element, qn("w:drawing"))

    buf = BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _read_docx_paragraphs(docx_bytes: bytes) -> list[str]:
    """Read all paragraph texts from a DOCX."""
    doc = Document(BytesIO(docx_bytes))
    return [p.text for p in doc.paragraphs]


@pytest.fixture
def service():
    return DocxRoundtripService()


class TestExtractStructured:
    def test_basic_extraction(self, service: DocxRoundtripService):
        docx_bytes = _make_docx("Hello", "World", "")
        result = service.extract_structured(docx_bytes)

        assert result["source_hash"]
        assert result["metadata"]["paragraph_count"] == 3
        assert result["metadata"]["table_count"] == 0
        assert len(result["lightweight"]) == 3
        assert result["lightweight"][0] == {"key": "p_0", "text": "Hello", "editable": True}
        assert result["lightweight"][1] == {"key": "p_1", "text": "World", "editable": True}
        assert result["lightweight"][2] == {"key": "p_2", "text": "", "editable": True}

    def test_empty_document(self, service: DocxRoundtripService):
        doc = Document()
        buf = BytesIO()
        doc.save(buf)
        result = service.extract_structured(buf.getvalue())

        assert result["metadata"]["paragraph_count"] == 0
        assert result["lightweight"] == []

    def test_source_hash_deterministic(self, service: DocxRoundtripService):
        docx_bytes = _make_docx("Test")
        r1 = service.extract_structured(docx_bytes)
        r2 = service.extract_structured(docx_bytes)
        assert r1["source_hash"] == r2["source_hash"]

    def test_bookmark_paragraph_is_editable(self, service: DocxRoundtripService):
        docx_bytes = _make_docx_with_bookmark("Bookmarked text")
        result = service.extract_structured(docx_bytes)

        # Bookmark paragraphs should be editable (SAFE tier)
        bm_para = next(p for p in result["lightweight"] if p["text"] == "Bookmarked text")
        assert bm_para["editable"] is True

    def test_hyperlink_paragraph_not_editable(self, service: DocxRoundtripService):
        docx_bytes = _make_docx_with_hyperlink()
        result = service.extract_structured(docx_bytes)

        # Hyperlink paragraphs should not be editable (RISKY tier)
        assert any(not p["editable"] for p in result["lightweight"])

    def test_table_extraction(self, service: DocxRoundtripService):
        docx_bytes = _make_docx_with_table()
        result = service.extract_structured(docx_bytes)

        assert result["metadata"]["table_count"] == 1
        keys = [p["key"] for p in result["lightweight"]]
        assert "tbl_0_r0_c0_p0" in keys
        assert "tbl_0_r1_c1_p0" in keys

        a1 = next(p for p in result["lightweight"] if p["key"] == "tbl_0_r0_c0_p0")
        assert a1["text"] == "A1"

    def test_drawing_paragraph_not_editable(self, service: DocxRoundtripService):
        docx_bytes = _make_docx_with_drawing()
        result = service.extract_structured(docx_bytes)

        assert any(not p["editable"] for p in result["lightweight"])

    def test_tab_and_newline_preserved(self, service: DocxRoundtripService):
        docx_bytes = _make_docx("Before\tAfter", "Line1\nLine2")
        result = service.extract_structured(docx_bytes)

        assert result["lightweight"][0]["text"] == "Before\tAfter"

    def test_rejects_oversized_file(self, service: DocxRoundtripService):
        # Create minimal docx, then test with fake large bytes
        with pytest.raises(ValueError, match="File too large"):
            service.extract_structured(b"\x00" * (25 * 1024 * 1024 + 1))

    def test_rejects_ole_file(self, service: DocxRoundtripService):
        ole_magic = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 100
        with pytest.raises(ValueError, match="Encrypted or legacy"):
            service.extract_structured(ole_magic)

    def test_rejects_docm_filename(self, service: DocxRoundtripService):
        docx_bytes = _make_docx("Test")
        with pytest.raises(ValueError, match=".docm"):
            service.extract_structured(docx_bytes, filename="test.docm")


class TestApplyStructured:
    def test_basic_apply(self, service: DocxRoundtripService):
        docx_bytes = _make_docx("Hello", "World")
        extracted = service.extract_structured(docx_bytes)

        modifications = [{"key": "p_0", "text": "Goodbye"}]
        result_bytes, report = service.apply_structured(docx_bytes, extracted["source_hash"], modifications)

        assert report["applied"] == 1
        paragraphs = _read_docx_paragraphs(result_bytes)
        assert paragraphs[0] == "Goodbye"
        assert paragraphs[1] == "World"

    def test_no_modifications(self, service: DocxRoundtripService):
        docx_bytes = _make_docx("Hello")
        extracted = service.extract_structured(docx_bytes)

        result_bytes, report = service.apply_structured(docx_bytes, extracted["source_hash"], [])

        assert report["applied"] == 0
        assert report["success"] is True

    def test_hash_mismatch_raises(self, service: DocxRoundtripService):
        docx_bytes = _make_docx("Hello")
        with pytest.raises(ValueError, match="Source hash mismatch"):
            service.apply_structured(docx_bytes, "wrong_hash", [])

    def test_unknown_key_skipped(self, service: DocxRoundtripService):
        docx_bytes = _make_docx("Hello")
        extracted = service.extract_structured(docx_bytes)

        modifications = [{"key": "p_999", "text": "Nope"}]
        _, report = service.apply_structured(docx_bytes, extracted["source_hash"], modifications)

        assert report["applied"] == 0
        assert "p_999" in report["skipped_unknown_key"]

    def test_no_change_skipped(self, service: DocxRoundtripService):
        docx_bytes = _make_docx("Hello")
        extracted = service.extract_structured(docx_bytes)

        modifications = [{"key": "p_0", "text": "Hello"}]
        _, report = service.apply_structured(docx_bytes, extracted["source_hash"], modifications)

        assert report["applied"] == 0
        assert "p_0" in report["skipped_no_change"]

    def test_not_editable_skipped(self, service: DocxRoundtripService):
        docx_bytes = _make_docx_with_hyperlink()
        extracted = service.extract_structured(docx_bytes)

        non_editable = next(p for p in extracted["lightweight"] if not p["editable"])
        modifications = [{"key": non_editable["key"], "text": "Modified"}]
        _, report = service.apply_structured(docx_bytes, extracted["source_hash"], modifications)

        assert report["applied"] == 0
        assert non_editable["key"] in report["skipped_not_editable"]

    def test_bold_format_preserved(self, service: DocxRoundtripService):
        docx_bytes = _make_docx("Bold text", bold_first_run=True)
        extracted = service.extract_structured(docx_bytes)

        modifications = [{"key": "p_0", "text": "New bold text"}]
        result_bytes, report = service.apply_structured(docx_bytes, extracted["source_hash"], modifications)

        assert report["applied"] == 1
        doc = Document(BytesIO(result_bytes))
        # First run should still be bold (format preserved via in-place modification)
        assert doc.paragraphs[0].runs[0].bold is True
        assert doc.paragraphs[0].text == "New bold text"

    def test_bookmark_preserved_after_apply(self, service: DocxRoundtripService):
        docx_bytes = _make_docx_with_bookmark("Original text", "TestBookmark")
        extracted = service.extract_structured(docx_bytes)

        bm_para = next(p for p in extracted["lightweight"] if p["text"] == "Original text")
        modifications = [{"key": bm_para["key"], "text": "Modified text"}]
        result_bytes, report = service.apply_structured(docx_bytes, extracted["source_hash"], modifications)

        assert report["applied"] == 1

        # Verify bookmark still exists in the XML
        doc = Document(BytesIO(result_bytes))
        for para in doc.paragraphs:
            if para.text == "Modified text":
                p_elem = para._element
                bm_starts = p_elem.findall(qn("w:bookmarkStart"))
                bm_ends = p_elem.findall(qn("w:bookmarkEnd"))
                assert len(bm_starts) == 1
                assert bm_starts[0].get(qn("w:name")) == "TestBookmark"
                assert len(bm_ends) == 1
                return
        pytest.fail("Modified paragraph with bookmark not found")

    def test_drawing_paragraph_skipped(self, service: DocxRoundtripService):
        docx_bytes = _make_docx_with_drawing()
        extracted = service.extract_structured(docx_bytes)

        non_editable = next(p for p in extracted["lightweight"] if not p["editable"])
        modifications = [{"key": non_editable["key"], "text": "Replace image"}]
        _, report = service.apply_structured(docx_bytes, extracted["source_hash"], modifications)

        assert report["applied"] == 0

    def test_table_cell_modification(self, service: DocxRoundtripService):
        docx_bytes = _make_docx_with_table()
        extracted = service.extract_structured(docx_bytes)

        modifications = [{"key": "tbl_0_r0_c0_p0", "text": "Modified A1"}]
        result_bytes, report = service.apply_structured(docx_bytes, extracted["source_hash"], modifications)

        assert report["applied"] == 1
        doc = Document(BytesIO(result_bytes))
        assert doc.tables[0].cell(0, 0).text == "Modified A1"
        assert doc.tables[0].cell(0, 1).text == "B1"  # Unchanged

    def test_roundtrip_no_modification(self, service: DocxRoundtripService):
        """Extract then apply with no modifications should preserve all text."""
        docx_bytes = _make_docx("Para 1", "Para 2", "", "Para 4")
        extracted = service.extract_structured(docx_bytes)

        result_bytes, report = service.apply_structured(docx_bytes, extracted["source_hash"], [])

        original_texts = _read_docx_paragraphs(docx_bytes)
        result_texts = _read_docx_paragraphs(result_bytes)
        assert original_texts == result_texts

    def test_multiple_modifications(self, service: DocxRoundtripService):
        docx_bytes = _make_docx("A", "B", "C", "D")
        extracted = service.extract_structured(docx_bytes)

        modifications = [
            {"key": "p_0", "text": "AA"},
            {"key": "p_2", "text": "CC"},
        ]
        result_bytes, report = service.apply_structured(docx_bytes, extracted["source_hash"], modifications)

        assert report["applied"] == 2
        paragraphs = _read_docx_paragraphs(result_bytes)
        assert paragraphs[0] == "AA"
        assert paragraphs[1] == "B"
        assert paragraphs[2] == "CC"
        assert paragraphs[3] == "D"


class TestTrackChanges:
    def test_track_changes_produces_del_ins(self, service: DocxRoundtripService):
        docx_bytes = _make_docx("Original text here")
        extracted = service.extract_structured(docx_bytes)

        modifications = [{"key": "p_0", "text": "Modified text here"}]
        result_bytes, report = service.apply_structured(
            docx_bytes,
            extracted["source_hash"],
            modifications,
            track_changes=True,
        )

        assert report["applied"] == 1

        # Verify w:del and w:ins elements exist
        doc = Document(BytesIO(result_bytes))
        p_elem = doc.paragraphs[0]._element
        dels = p_elem.findall(f".//{qn('w:del')}")
        ins = p_elem.findall(f".//{qn('w:ins')}")
        assert len(dels) > 0, "Expected w:del elements"
        assert len(ins) > 0, "Expected w:ins elements"

    def test_track_changes_has_author(self, service: DocxRoundtripService):
        docx_bytes = _make_docx("Hello world")
        extracted = service.extract_structured(docx_bytes)

        modifications = [{"key": "p_0", "text": "Goodbye world"}]
        result_bytes, _ = service.apply_structured(
            docx_bytes,
            extracted["source_hash"],
            modifications,
            track_changes=True,
            author="Test Author",
        )

        doc = Document(BytesIO(result_bytes))
        p_elem = doc.paragraphs[0]._element
        ins_elems = p_elem.findall(f".//{qn('w:ins')}")
        assert any(e.get(qn("w:author")) == "Test Author" for e in ins_elems)

    def test_track_changes_low_similarity_fallback(self, service: DocxRoundtripService):
        docx_bytes = _make_docx("AAAA BBBB CCCC DDDD")
        extracted = service.extract_structured(docx_bytes)

        # Completely different text → similarity < 0.3 → whole paragraph fallback
        modifications = [{"key": "p_0", "text": "XXXX YYYY ZZZZ WWWW 1234 5678"}]
        result_bytes, report = service.apply_structured(
            docx_bytes,
            extracted["source_hash"],
            modifications,
            track_changes=True,
        )

        assert report["applied"] == 1
        doc = Document(BytesIO(result_bytes))
        p_elem = doc.paragraphs[0]._element
        dels = p_elem.findall(f".//{qn('w:del')}")
        ins = p_elem.findall(f".//{qn('w:ins')}")
        assert len(dels) > 0
        assert len(ins) > 0

    def test_track_changes_preserves_unmodified(self, service: DocxRoundtripService):
        docx_bytes = _make_docx("Keep this", "Change this")
        extracted = service.extract_structured(docx_bytes)

        modifications = [{"key": "p_1", "text": "Changed"}]
        result_bytes, _ = service.apply_structured(
            docx_bytes,
            extracted["source_hash"],
            modifications,
            track_changes=True,
        )

        doc = Document(BytesIO(result_bytes))
        # First paragraph should have no track changes
        p0 = doc.paragraphs[0]._element
        assert len(p0.findall(f".//{qn('w:del')}")) == 0
        assert len(p0.findall(f".//{qn('w:ins')}")) == 0
        assert doc.paragraphs[0].text == "Keep this"

    def test_track_changes_unique_ids(self, service: DocxRoundtripService):
        docx_bytes = _make_docx("Text A", "Text B")
        extracted = service.extract_structured(docx_bytes)

        modifications = [
            {"key": "p_0", "text": "Modified A"},
            {"key": "p_1", "text": "Modified B"},
        ]
        result_bytes, _ = service.apply_structured(
            docx_bytes,
            extracted["source_hash"],
            modifications,
            track_changes=True,
        )

        doc = Document(BytesIO(result_bytes))
        ids = set()
        for elem in doc.element.iter():
            wid = elem.get(qn("w:id"))
            if wid is not None and elem.tag in (qn("w:del"), qn("w:ins")):
                assert wid not in ids, f"Duplicate w:id: {wid}"
                ids.add(wid)
