"""Tests for the document diff service.

Covers:
- Text normalization (Unicode quotes, dashes, whitespace, image placeholders)
- Paragraph splitting
- Diff correctness (identical, completely different, single change, additions, deletions)
- Change block grouping and hunk merging
- max_changes truncation
- Divergence threshold detection
- Unicode/German text handling
"""

from __future__ import annotations

import pytest

from app.services.diff_service import (
    DIVERGENCE_THRESHOLD,
    INLINE_DIFF_MAX_CHARS,
    MERGE_GAP_THRESHOLD,
    ChangeBlock,
    DiffItem,
    compute_diff,
    compute_inline_diff,
    extract_clause_ref,
    normalize_text,
    split_paragraphs,
)


# ============================================================================
# Text Normalization
# ============================================================================


class TestNormalizeText:
    def test_curly_double_quotes(self):
        assert normalize_text("\u201cHello\u201d") == '"Hello"'

    def test_curly_single_quotes(self):
        assert normalize_text("\u2018it\u2019s\u201a") == "'it's'"

    def test_angle_quotes(self):
        assert normalize_text("\u00abtext\u00bb") == '"text"'

    def test_em_dash(self):
        assert normalize_text("a\u2014b") == "a--b"

    def test_en_dash(self):
        assert normalize_text("a\u2013b") == "a--b"

    def test_figure_dash(self):
        assert normalize_text("a\u2012b") == "a-b"

    def test_image_placeholder_removed(self):
        text = "Before [Image: a photo of a cat] After"
        result = normalize_text(text)
        assert "[Image:" not in result
        assert "Before" in result
        assert "After" in result

    def test_table_prefix_removed(self):
        text = "[Table]\nCell1 | Cell2"
        result = normalize_text(text)
        assert not result.startswith("[Table]")
        assert "Cell1 | Cell2" in result

    def test_multiple_spaces_collapsed(self):
        assert normalize_text("a   b  c") == "a b c"

    def test_trailing_whitespace_stripped(self):
        assert normalize_text("hello   \nworld  ") == "hello\nworld"

    def test_preserves_normal_text(self):
        text = "This is normal text with numbers 123 and symbols !@#"
        assert normalize_text(text) == text

    def test_german_text_preserved(self):
        text = "Gesellschafterbindungsvertr\u00e4ge und \u00dcberpr\u00fcfung der Saldobilanzen"
        assert normalize_text(text) == text


# ============================================================================
# Paragraph Splitting
# ============================================================================


class TestSplitParagraphs:
    def test_basic_split(self):
        text = "Para 1\n\nPara 2\n\nPara 3"
        assert split_paragraphs(text) == ["Para 1", "Para 2", "Para 3"]

    def test_filters_empty_paragraphs(self):
        text = "Para 1\n\n\n\nPara 2"
        result = split_paragraphs(text)
        assert result == ["Para 1", "Para 2"]

    def test_strips_whitespace(self):
        text = "  Para 1  \n\n  Para 2  "
        assert split_paragraphs(text) == ["Para 1", "Para 2"]

    def test_single_paragraph(self):
        assert split_paragraphs("Just one paragraph") == ["Just one paragraph"]

    def test_empty_string(self):
        assert split_paragraphs("") == []

    def test_whitespace_only(self):
        assert split_paragraphs("   \n\n   \n\n   ") == []


# ============================================================================
# Diff Correctness
# ============================================================================


class TestComputeDiff:
    def test_identical_documents(self):
        text = "Para 1\n\nPara 2\n\nPara 3"
        result = compute_diff(text, text)
        assert result.change_blocks == []
        assert result.stats.unchanged == 3
        assert result.stats.modified == 0
        assert result.stats.added == 0
        assert result.stats.deleted == 0
        assert result.stats.high_divergence is False
        assert result.truncated is False

    def test_completely_different(self):
        base = "Alpha\n\nBeta\n\nGamma"
        comp = "One\n\nTwo\n\nThree"
        result = compute_diff(base, comp)
        assert result.stats.unchanged == 0
        assert result.stats.high_divergence is True
        total_changes = result.stats.modified + result.stats.added + result.stats.deleted
        assert total_changes == 3

    def test_single_word_change(self):
        base = "The deadline is 30 days."
        comp = "The deadline is 60 days."
        result = compute_diff(base, comp)
        assert result.stats.modified == 1
        assert len(result.change_blocks) == 1
        block = result.change_blocks[0]
        items = [i for i in block.items if i.type != "context"]
        assert items[0].type == "modified"
        assert items[0].base_content == "The deadline is 30 days."
        assert items[0].comparison_content == "The deadline is 60 days."

    def test_paragraph_added_at_end(self):
        base = "Para 1\n\nPara 2"
        comp = "Para 1\n\nPara 2\n\nPara 3 new"
        result = compute_diff(base, comp)
        assert result.stats.added == 1
        assert result.stats.unchanged == 2
        items = [i for block in result.change_blocks for i in block.items if i.type == "added"]
        assert len(items) == 1
        assert items[0].comparison_content == "Para 3 new"

    def test_paragraph_added_at_beginning(self):
        base = "Para 1\n\nPara 2"
        comp = "New intro\n\nPara 1\n\nPara 2"
        result = compute_diff(base, comp)
        assert result.stats.added == 1

    def test_paragraph_deleted(self):
        base = "Para 1\n\nPara 2\n\nPara 3"
        comp = "Para 1\n\nPara 3"
        result = compute_diff(base, comp)
        assert result.stats.deleted == 1
        items = [i for block in result.change_blocks for i in block.items if i.type == "deleted"]
        assert len(items) == 1
        assert items[0].base_content == "Para 2"

    def test_multiple_changes(self):
        base = "A\n\nB\n\nC\n\nD\n\nE"
        comp = "A\n\nB modified\n\nC\n\nD\n\nE\n\nF new"
        result = compute_diff(base, comp)
        assert result.stats.modified >= 1 or result.stats.added >= 1

    def test_unicode_german_text(self):
        base = "Die Gesellschaft hat folgende Verpflichtungen:\n\n\u00dcberpr\u00fcfung der Saldobilanzen"
        comp = "Die Gesellschaft hat folgende Verpflichtungen:\n\nPr\u00fcfung der Jahresabschl\u00fcsse"
        result = compute_diff(base, comp)
        assert result.stats.modified == 1
        assert result.stats.unchanged == 1

    def test_empty_base(self):
        result = compute_diff("", "New content")
        assert result.stats.added == 1
        assert result.stats.total_paragraphs_base == 0

    def test_empty_comparison(self):
        result = compute_diff("Some content", "")
        assert result.stats.deleted == 1
        assert result.stats.total_paragraphs_comparison == 0

    def test_both_empty(self):
        result = compute_diff("", "")
        assert result.change_blocks == []
        assert result.stats.unchanged == 0


# ============================================================================
# Change Block Grouping
# ============================================================================


class TestChangeBlockGrouping:
    def _make_doc(self, n_paras: int, prefix: str = "Para") -> str:
        return "\n\n".join(f"{prefix} {i}" for i in range(n_paras))

    def test_adjacent_changes_merge(self):
        """Two adjacent changed paragraphs should be in one block."""
        base = "A\n\nB\n\nC"
        comp = "A modified\n\nB modified\n\nC"
        result = compute_diff(base, comp)
        assert len(result.change_blocks) == 1

    def test_close_changes_merge_with_inline_context(self):
        """Changes separated by <=MERGE_GAP_THRESHOLD equal paras merge."""
        gap = MERGE_GAP_THRESHOLD
        # Build: [changed] [gap equal paras] [changed]
        base_paras = ["change1"] + [f"same {i}" for i in range(gap)] + ["change2"]
        comp_paras = ["CHANGE1"] + [f"same {i}" for i in range(gap)] + ["CHANGE2"]
        base = "\n\n".join(base_paras)
        comp = "\n\n".join(comp_paras)
        result = compute_diff(base, comp)
        # Should be 1 merged block
        assert len(result.change_blocks) == 1
        # Should have inline context items
        context_items = [i for i in result.change_blocks[0].items if i.type == "context"]
        assert len(context_items) == gap

    def test_distant_changes_separate(self):
        """Changes separated by >MERGE_GAP_THRESHOLD equal paras are separate blocks."""
        gap = MERGE_GAP_THRESHOLD + 1
        base_paras = ["change1"] + [f"same {i}" for i in range(gap)] + ["change2"]
        comp_paras = ["CHANGE1"] + [f"same {i}" for i in range(gap)] + ["CHANGE2"]
        base = "\n\n".join(base_paras)
        comp = "\n\n".join(comp_paras)
        result = compute_diff(base, comp)
        assert len(result.change_blocks) == 2

    def test_context_before_set(self):
        """First change should have context_before from preceding equal paragraph."""
        base = "Intro paragraph\n\nChanged paragraph"
        comp = "Intro paragraph\n\nModified paragraph"
        result = compute_diff(base, comp)
        assert len(result.change_blocks) == 1
        assert result.change_blocks[0].context_before is not None
        assert "Intro" in result.change_blocks[0].context_before

    def test_context_after_set(self):
        """Change followed by distant equal should have context_after."""
        gap = MERGE_GAP_THRESHOLD + 1
        base_paras = ["change1"] + [f"following {i}" for i in range(gap)]
        comp_paras = ["CHANGE1"] + [f"following {i}" for i in range(gap)]
        base = "\n\n".join(base_paras)
        comp = "\n\n".join(comp_paras)
        result = compute_diff(base, comp)
        assert len(result.change_blocks) == 1
        assert result.change_blocks[0].context_after is not None
        assert "following" in result.change_blocks[0].context_after

    def test_context_truncated(self):
        """Context paragraphs should be truncated to ~200 chars."""
        long_para = "A" * 500
        base = f"{long_para}\n\nChanged"
        comp = f"{long_para}\n\nModified"
        result = compute_diff(base, comp)
        ctx = result.change_blocks[0].context_before
        assert ctx is not None
        assert len(ctx) <= 204  # 200 + "..."


# ============================================================================
# Truncation and Divergence
# ============================================================================


class TestTruncationAndDivergence:
    def test_max_changes_truncation(self):
        """Should truncate when exceeding max_changes."""
        base = "\n\n".join(f"base {i}" for i in range(20))
        comp = "\n\n".join(f"comp {i}" for i in range(20))
        result = compute_diff(base, comp, max_changes=5)
        total_change_items = sum(1 for block in result.change_blocks for item in block.items if item.type != "context")
        assert total_change_items <= 5
        assert result.truncated is True

    def test_no_truncation_when_under_limit(self):
        base = "A\n\nB"
        comp = "A\n\nB modified"
        result = compute_diff(base, comp, max_changes=500)
        assert result.truncated is False

    def test_high_divergence_detected(self):
        """Documents with >70% changes should flag high_divergence."""
        base = "\n\n".join(f"base {i}" for i in range(10))
        comp = "\n\n".join(f"comp {i}" for i in range(10))
        result = compute_diff(base, comp)
        assert result.stats.high_divergence is True

    def test_low_divergence(self):
        """Documents with <70% changes should not flag high_divergence."""
        paras = [f"same {i}" for i in range(10)]
        base_paras = paras.copy()
        comp_paras = paras.copy()
        comp_paras[0] = "modified 0"
        base = "\n\n".join(base_paras)
        comp = "\n\n".join(comp_paras)
        result = compute_diff(base, comp)
        assert result.stats.high_divergence is False


# ============================================================================
# Serialization
# ============================================================================


class TestSerialization:
    def test_to_dict_roundtrip(self):
        base = "Para 1\n\nPara 2\n\nPara 3"
        comp = "Para 1\n\nPara 2 modified\n\nPara 3"
        result = compute_diff(base, comp)
        d = result.to_dict()
        assert "change_blocks" in d
        assert "stats" in d
        assert "truncated" in d
        assert isinstance(d["change_blocks"], list)
        assert isinstance(d["stats"], dict)

    def test_diff_item_context_serialization(self):
        item = DiffItem(type="context", content="some context")
        d = item.to_dict()
        assert d == {"type": "context", "content": "some context"}

    def test_diff_item_modified_serialization(self):
        item = DiffItem(type="modified", base_content="old", comparison_content="new")
        d = item.to_dict()
        assert d == {"type": "modified", "base_content": "old", "comparison_content": "new"}

    def test_diff_item_with_inline_diff_and_clause_ref(self):
        item = DiffItem(
            type="modified",
            base_content="old",
            comparison_content="new",
            inline_diff="[-old-] {+new+}",
            clause_ref="Section 7.1",
        )
        d = item.to_dict()
        assert d["inline_diff"] == "[-old-] {+new+}"
        assert d["clause_ref"] == "Section 7.1"

    def test_diff_item_none_fields_omitted(self):
        item = DiffItem(type="added", comparison_content="new text")
        d = item.to_dict()
        assert "inline_diff" not in d
        assert "clause_ref" not in d


# ============================================================================
# Inline Diff
# ============================================================================


class TestComputeInlineDiff:
    def test_single_word_change(self):
        result = compute_inline_diff("deadline is 30 days", "deadline is 60 days")
        assert "[-30-]" in result
        assert "{+60+}" in result
        assert "deadline is" in result

    def test_word_addition(self):
        result = compute_inline_diff("shall pay", "shall promptly pay")
        assert "{+promptly+}" in result

    def test_word_deletion(self):
        result = compute_inline_diff("shall immediately notify", "shall notify")
        assert "[-immediately-]" in result

    def test_long_text_returns_none(self):
        long_text = "word " * (INLINE_DIFF_MAX_CHARS // 4)
        assert compute_inline_diff(long_text, long_text) is None

    def test_boundary_length(self):
        text = "a" * INLINE_DIFF_MAX_CHARS
        result = compute_inline_diff(text, text)
        assert result is not None

    def test_empty_strings(self):
        assert compute_inline_diff("", "") is None

    def test_single_word_paragraphs(self):
        result = compute_inline_diff("Yes", "No")
        assert "[-Yes-]" in result
        assert "{+No+}" in result

    def test_unicode_german(self):
        result = compute_inline_diff("Frist beträgt 30 Tage", "Frist beträgt 60 Tage")
        assert "[-30-]" in result
        assert "{+60+}" in result

    def test_punctuation_change(self):
        result = compute_inline_diff("30 days.", "30 days,")
        assert "[-days.-]" in result
        assert "{+days,+}" in result

    def test_integrated_in_compute_diff(self):
        base = "The deadline is 30 days."
        comp = "The deadline is 60 days."
        result = compute_diff(base, comp)
        items = [i for b in result.change_blocks for i in b.items if i.type == "modified"]
        assert len(items) == 1
        assert items[0].inline_diff is not None
        assert "[-30-]" in items[0].inline_diff


# ============================================================================
# Clause Reference Extraction
# ============================================================================


class TestExtractClauseRef:
    def test_section_ref(self):
        assert extract_clause_ref("Section 7.1.2 provides...") == "Section 7.1.2"

    def test_ziff_ref(self):
        assert extract_clause_ref("Gemäss Ziff. 3.2 hat...") == "Ziff. 3.2"

    def test_single_paragraph_mark(self):
        assert extract_clause_ref("§ 5 regelt...") == "§ 5"

    def test_double_paragraph_mark(self):
        assert extract_clause_ref("§§ 205, 210 OR") == "§§ 205, 210"

    def test_art_ref(self):
        assert extract_clause_ref("Art. 192 OR") == "Art. 192"

    def test_artikel_ff(self):
        assert extract_clause_ref("Artikel 23 ff. OR") == "Artikel 23 ff."

    def test_abs_ref(self):
        assert extract_clause_ref("Abs. 2 regelt...") == "Abs. 2"

    def test_anhang_ref(self):
        assert extract_clause_ref("Anhang 1") == "Anhang 1"

    def test_no_ref(self):
        assert extract_clause_ref("The parties agree...") is None

    def test_ref_in_parens(self):
        result = extract_clause_ref("(siehe Art. 192 OR)")
        assert result == "Art. 192"

    def test_integrated_in_compute_diff(self):
        base = "Section 7.1 old text"
        comp = "Section 7.1 new text"
        result = compute_diff(base, comp)
        items = [i for b in result.change_blocks for i in b.items if i.type == "modified"]
        assert len(items) == 1
        assert items[0].clause_ref == "Section 7.1"


# ============================================================================
# Page Number Integration
# ============================================================================


class TestPageNumbers:
    def test_no_page_breaks_no_pages(self):
        result = compute_diff("A\n\nB", "A\n\nC")
        items = [i for b in result.change_blocks for i in b.items if i.type != "context"]
        assert all(i.base_page is None for i in items)
        assert all(i.comparison_page is None for i in items)

    def test_page_breaks_annotate_items(self):
        base = "Para 1\n\nPara 2\n\nPara 3"
        comp = "Para 1\n\nPara 2 modified\n\nPara 3"
        result = compute_diff(base, comp, base_page_breaks=[1], comp_page_breaks=[1])
        items = [i for b in result.change_blocks for i in b.items if i.type == "modified"]
        assert len(items) == 1
        assert items[0].base_page is not None
        assert items[0].comparison_page is not None

    def test_page_numbers_serialization(self):
        item = DiffItem(type="modified", base_content="a", comparison_content="b", base_page=2, comparison_page=3)
        d = item.to_dict()
        assert d["base_page"] == 2
        assert d["comparison_page"] == 3

    def test_page_numbers_omitted_when_none(self):
        item = DiffItem(type="modified", base_content="a", comparison_content="b")
        d = item.to_dict()
        assert "base_page" not in d
        assert "comparison_page" not in d
