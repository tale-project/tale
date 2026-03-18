"""
Track Changes writer for DOCX round-trip editing.

Generates OOXML revision markup (<w:del>, <w:ins>) using word-level diff.
Uses lxml to manipulate the XML directly within python-docx Document objects.
"""

from __future__ import annotations

import contextlib
import difflib
import os
import re
from copy import deepcopy
from datetime import UTC, datetime

from docx.oxml.ns import qn
from loguru import logger
from lxml import etree

_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _tokenize_words(text: str) -> list[str]:
    """Split text into word tokens preserving whitespace as separate tokens."""
    tokens: list[str] = []
    for match in re.finditer(r"\S+|\s+", text):
        tokens.append(match.group())
    return tokens


def _join_tokens(tokens: list[str]) -> str:
    return "".join(tokens)


class TrackChangesWriter:
    """Generates OOXML Track Changes markup for modified paragraphs."""

    def __init__(self, doc_element, author: str = "AI Assistant"):
        self.author = author
        self.date = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.next_id = self._scan_max_id(doc_element) + 1
        self.rsid = self._generate_rsid()

    def _scan_max_id(self, root) -> int:
        """Find the maximum w:id value in the document."""
        max_id = 0
        for elem in root.iter():
            val = elem.get(qn("w:id"))
            if val is not None:
                with contextlib.suppress(ValueError):
                    max_id = max(max_id, int(val))
        return max_id

    def _generate_rsid(self) -> str:
        """Generate a random 8-character hex rsid."""
        return os.urandom(4).hex().upper()

    def _alloc_id(self) -> str:
        """Allocate the next unique revision ID."""
        rid = str(self.next_id)
        self.next_id += 1
        return rid

    def _get_rpr_copy(self, run_element) -> etree.Element | None:
        """Copy the rPr from a run element, or None if absent."""
        rpr = run_element.find(qn("w:rPr"))
        if rpr is not None:
            return deepcopy(rpr)
        return None

    def _make_run(self, text: str, rpr: etree.Element | None, is_del: bool = False) -> etree.Element:
        """Create a w:r element with optional rPr and text."""
        r = etree.SubElement(etree.Element("dummy"), qn("w:r"))
        r.set(qn("w:rsidR"), self.rsid)

        if rpr is not None:
            r.append(deepcopy(rpr))

        t = etree.SubElement(r, qn("w:delText")) if is_del else etree.SubElement(r, qn("w:t"))

        t.text = text
        if text and (text[0] == " " or text[-1] == " "):
            t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")

        return r

    def _wrap_del(self, run_element: etree.Element) -> etree.Element:
        """Wrap a run in <w:del>."""
        del_elem = etree.Element(qn("w:del"))
        del_elem.set(qn("w:id"), self._alloc_id())
        del_elem.set(qn("w:author"), self.author)
        del_elem.set(qn("w:date"), self.date)

        # Convert w:t to w:delText
        run_copy = deepcopy(run_element)
        for t in run_copy.findall(qn("w:t")):
            t.tag = qn("w:delText")
            if t.text and (t.text[0] == " " or t.text[-1] == " "):
                t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")

        del_elem.append(run_copy)
        return del_elem

    def _wrap_ins(self, run_element: etree.Element) -> etree.Element:
        """Wrap a run in <w:ins>."""
        ins_elem = etree.Element(qn("w:ins"))
        ins_elem.set(qn("w:id"), self._alloc_id())
        ins_elem.set(qn("w:author"), self.author)
        ins_elem.set(qn("w:date"), self.date)
        ins_elem.append(run_element)
        return ins_elem

    def apply_paragraph_change(self, para, old_text: str, new_text: str) -> None:
        """Apply tracked change to a paragraph using word-level diff.

        Args:
            para: python-docx Paragraph object
            old_text: Original concatenated text
            new_text: New text to apply
        """
        p_element = para._element

        # Collect original runs
        original_runs = list(p_element.findall(qn("w:r")))
        if not original_runs:
            return

        # Get rPr from first run as default format for new text
        default_rpr = self._get_rpr_copy(original_runs[0])

        # Check similarity — if too different, do whole-paragraph del+ins
        ratio = difflib.SequenceMatcher(None, old_text, new_text).ratio()

        if ratio < 0.3:
            self._apply_whole_paragraph_change(p_element, original_runs, new_text, default_rpr)
            return

        # Word-level diff
        old_tokens = _tokenize_words(old_text)
        new_tokens = _tokenize_words(new_text)

        matcher = difflib.SequenceMatcher(None, old_tokens, new_tokens)
        opcodes = matcher.get_opcodes()

        # Build new children list (preserving non-run children in position)
        new_children: list[etree.Element] = []

        # Collect non-run children with their positions
        non_run_children = []
        run_positions = []
        for idx, child in enumerate(p_element):
            if child.tag == qn("w:r"):
                run_positions.append(idx)
            elif child.tag != qn("w:pPr"):
                non_run_children.append((idx, child))

        # Map character positions to runs
        run_char_ranges: list[tuple[int, int, etree.Element]] = []
        char_pos = 0
        for run_el in original_runs:
            t_el = run_el.find(qn("w:t"))
            run_text = t_el.text if t_el is not None and t_el.text else ""
            run_char_ranges.append((char_pos, char_pos + len(run_text), run_el))
            char_pos += len(run_text)

        # Build token-to-character position map
        old_token_char_starts: list[int] = []
        pos = 0
        for token in old_tokens:
            old_token_char_starts.append(pos)
            pos += len(token)

        for op, i1, i2, j1, j2 in opcodes:
            if op == "equal":
                # Find which original runs cover this text range and keep them
                if old_tokens[i1:i2]:
                    start_char = old_token_char_starts[i1]
                    end_char = old_token_char_starts[i2 - 1] + len(old_tokens[i2 - 1])
                    for run_start, run_end, run_el in run_char_ranges:
                        if run_end > start_char and run_start < end_char:
                            # This run overlaps the equal region
                            overlap_start = max(run_start, start_char)
                            overlap_end = min(run_end, end_char)
                            t_el = run_el.find(qn("w:t"))
                            full_text = t_el.text if t_el is not None and t_el.text else ""

                            if overlap_start == run_start and overlap_end == run_end:
                                # Whole run is in equal region — keep as-is
                                new_children.append(deepcopy(run_el))
                            else:
                                # Partial run — extract the equal portion
                                local_start = overlap_start - run_start
                                local_end = overlap_end - run_start
                                partial_text = full_text[local_start:local_end]
                                if partial_text:
                                    rpr = self._get_rpr_copy(run_el)
                                    new_children.append(self._make_run(partial_text, rpr))

            elif op == "replace":
                # Delete old tokens
                if old_tokens[i1:i2]:
                    start_char = old_token_char_starts[i1]
                    end_char = old_token_char_starts[i2 - 1] + len(old_tokens[i2 - 1])

                    for run_start, run_end, run_el in run_char_ranges:
                        if run_end > start_char and run_start < end_char:
                            overlap_start = max(run_start, start_char)
                            overlap_end = min(run_end, end_char)
                            t_el = run_el.find(qn("w:t"))
                            full_text = t_el.text if t_el is not None and t_el.text else ""

                            if overlap_start == run_start and overlap_end == run_end:
                                new_children.append(self._wrap_del(run_el))
                            else:
                                local_start = overlap_start - run_start
                                local_end = overlap_end - run_start
                                partial_text = full_text[local_start:local_end]
                                if partial_text:
                                    rpr = self._get_rpr_copy(run_el)
                                    partial_run = self._make_run(partial_text, rpr)
                                    new_children.append(self._wrap_del(partial_run))

                # Insert new tokens
                if new_tokens[j1:j2]:
                    ins_text = _join_tokens(new_tokens[j1:j2])
                    ins_run = self._make_run(ins_text, default_rpr)
                    new_children.append(self._wrap_ins(ins_run))

            elif op == "delete":
                if old_tokens[i1:i2]:
                    start_char = old_token_char_starts[i1]
                    end_char = old_token_char_starts[i2 - 1] + len(old_tokens[i2 - 1])

                    for run_start, run_end, run_el in run_char_ranges:
                        if run_end > start_char and run_start < end_char:
                            overlap_start = max(run_start, start_char)
                            overlap_end = min(run_end, end_char)
                            t_el = run_el.find(qn("w:t"))
                            full_text = t_el.text if t_el is not None and t_el.text else ""

                            if overlap_start == run_start and overlap_end == run_end:
                                new_children.append(self._wrap_del(run_el))
                            else:
                                local_start = overlap_start - run_start
                                local_end = overlap_end - run_start
                                partial_text = full_text[local_start:local_end]
                                if partial_text:
                                    rpr = self._get_rpr_copy(run_el)
                                    partial_run = self._make_run(partial_text, rpr)
                                    new_children.append(self._wrap_del(partial_run))

            elif op == "insert" and new_tokens[j1:j2]:
                ins_text = _join_tokens(new_tokens[j1:j2])
                ins_run = self._make_run(ins_text, default_rpr)
                new_children.append(self._wrap_ins(ins_run))

        # Replace paragraph content: keep pPr and non-run children, swap runs
        self._rebuild_paragraph(p_element, new_children, non_run_children)

    def _apply_whole_paragraph_change(
        self,
        p_element: etree.Element,
        original_runs: list[etree.Element],
        new_text: str,
        default_rpr: etree.Element | None,
    ) -> None:
        """Fallback: delete all original runs, insert new text as single run."""
        non_run_children = []
        for child in p_element:
            if child.tag != qn("w:r") and child.tag != qn("w:pPr"):
                non_run_children.append((0, child))

        new_children: list[etree.Element] = []

        # Delete all original runs
        for run_el in original_runs:
            new_children.append(self._wrap_del(run_el))

        # Insert new text
        ins_run = self._make_run(new_text, default_rpr)
        new_children.append(self._wrap_ins(ins_run))

        self._rebuild_paragraph(p_element, new_children, non_run_children)

    def _rebuild_paragraph(
        self,
        p_element: etree.Element,
        new_children: list[etree.Element],
        non_run_children: list[tuple[int, etree.Element]],
    ) -> None:
        """Rebuild paragraph content preserving pPr and non-run children."""
        # Save pPr
        ppr = p_element.find(qn("w:pPr"))
        ppr_copy = deepcopy(ppr) if ppr is not None else None

        # Save non-run children
        saved_non_run = [(idx, deepcopy(child)) for idx, child in non_run_children]

        # Clear everything
        for child in list(p_element):
            p_element.remove(child)

        # Restore pPr first
        if ppr_copy is not None:
            p_element.append(ppr_copy)

        # Add non-run children that came before runs
        for idx, child in saved_non_run:
            if idx == 0 or (ppr_copy is not None and idx <= 1):
                p_element.append(child)

        # Add new run/del/ins children
        for child in new_children:
            p_element.append(child)

        # Add remaining non-run children
        for idx, child in saved_non_run:
            if not (idx == 0 or (ppr_copy is not None and idx <= 1)):
                p_element.append(child)

    def register_rsid(self, doc) -> None:
        """Register our rsid in the document's settings.xml."""
        try:
            settings_part = doc.settings.element
            rsids = settings_part.find(qn("w:rsids"))
            if rsids is None:
                rsids = etree.SubElement(settings_part, qn("w:rsids"))

            rsid_elem = etree.SubElement(rsids, qn("w:rsid"))
            rsid_elem.set(qn("w:val"), self.rsid)

            # Ensure revision markup is visible
            rev_view = settings_part.find(qn("w:revisionView"))
            if rev_view is not None:
                markup = rev_view.get(qn("w:markup"))
                if markup == "0":
                    rev_view.set(qn("w:markup"), "1")

        except Exception as e:
            logger.warning(f"Failed to register rsid: {e}")
