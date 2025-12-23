#!/usr/bin/env python3
"""
Test PDF text extraction using unstructured library (same as RAG service).

This script should be run inside the RAG container to test PDF extraction.

Usage (from host):
    docker compose cp /path/to/document.pdf rag:/tmp/test.pdf
    docker compose exec rag python /app/scripts/test_pdf_extraction_docker.py /tmp/test.pdf
"""

import sys
from pathlib import Path


def test_with_unstructured(pdf_path: str, search_term: str | None = None):
    """Extract text using unstructured library (same as Cognee uses)."""
    try:
        from unstructured.partition.pdf import partition_pdf
    except ImportError:
        print("Error: unstructured not available")
        return

    print("=" * 80)
    print("UNSTRUCTURED PDF EXTRACTION")
    print("=" * 80)

    try:
        elements = partition_pdf(pdf_path)
        print(f"Total elements extracted: {len(elements)}")
        print()

        for i, element in enumerate(elements):
            element_type = type(element).__name__
            text = str(element)

            # Filter by search term if provided
            if search_term:
                if search_term.lower() not in text.lower():
                    continue

            print(f"[{i}] {element_type}:")
            if len(text) > 500:
                print(f"  {text[:500]}...")
            else:
                print(f"  {text}")
            print()

        # Summary
        print("=" * 80)
        print("ELEMENT TYPE SUMMARY")
        print("=" * 80)
        type_counts = {}
        for element in elements:
            t = type(element).__name__
            type_counts[t] = type_counts.get(t, 0) + 1
        for t, count in sorted(type_counts.items(), key=lambda x: -x[1]):
            print(f"  {t}: {count}")

        # Search term analysis
        if search_term:
            print()
            print("=" * 80)
            print(f"SEARCH TERM ANALYSIS: '{search_term}'")
            print("=" * 80)
            found_in = []
            for i, element in enumerate(elements):
                if search_term.lower() in str(element).lower():
                    found_in.append((i, type(element).__name__, str(element)[:100]))

            if found_in:
                print(f"Found in {len(found_in)} elements:")
                for idx, elem_type, preview in found_in:
                    print(f"  [{idx}] {elem_type}: {preview}...")
            else:
                print(f"WARNING: '{search_term}' NOT FOUND in any element!")

    except Exception as e:
        print(f"Error extracting PDF: {e}")
        import traceback
        traceback.print_exc()


def test_with_pypdf(pdf_path: str, search_term: str | None = None):
    """Extract text using pypdf (alternative method)."""
    try:
        from pypdf import PdfReader
    except ImportError:
        print("pypdf not available")
        return

    print()
    print("=" * 80)
    print("PYPDF EXTRACTION (ALTERNATIVE)")
    print("=" * 80)

    try:
        reader = PdfReader(pdf_path)
        print(f"Total pages: {len(reader.pages)}")
        print(f"Metadata: {reader.metadata}")
        print()

        total_chars = 0
        for page_num, page in enumerate(reader.pages, start=1):
            text = page.extract_text() or ""
            total_chars += len(text)

            if search_term:
                if search_term.lower() in text.lower():
                    print(f"PAGE {page_num}: Contains '{search_term}'")
                    # Find and show context around search term
                    idx = text.lower().find(search_term.lower())
                    start = max(0, idx - 200)
                    end = min(len(text), idx + len(search_term) + 200)
                    print(f"  Context: ...{text[start:end]}...")
                    print()

        print(f"Total characters extracted: {total_chars}")

    except Exception as e:
        print(f"Error: {e}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python test_pdf_extraction_docker.py <pdf_path> [search_term]")
        sys.exit(1)

    pdf_path = sys.argv[1]
    search_term = sys.argv[2] if len(sys.argv) > 2 else None

    if not Path(pdf_path).exists():
        print(f"Error: File not found: {pdf_path}")
        sys.exit(1)

    print(f"Testing PDF extraction: {pdf_path}")
    if search_term:
        print(f"Search term: {search_term}")
    print()

    test_with_unstructured(pdf_path, search_term)
    test_with_pypdf(pdf_path, search_term)


if __name__ == "__main__":
    main()

