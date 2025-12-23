#!/usr/bin/env python3
"""
Test PDF text extraction to debug RAG ingestion issues.

This script extracts text from a PDF file and helps identify
if certain sections are being properly extracted.

Usage:
    python scripts/test_pdf_extraction.py /path/to/document.pdf
    python scripts/test_pdf_extraction.py /path/to/document.pdf --search "2.4"
"""

import argparse
import sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    print("Error: PyMuPDF not installed. Install with: pip install pymupdf")
    sys.exit(1)


def extract_pdf_text(pdf_path: str, search_term: str | None = None) -> None:
    """Extract and display text from a PDF file."""
    path = Path(pdf_path)
    if not path.exists():
        print(f"Error: File not found: {pdf_path}")
        sys.exit(1)

    print(f"Opening PDF: {pdf_path}")
    print("=" * 80)

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(f"Error opening PDF: {e}")
        sys.exit(1)

    print(f"Total pages: {doc.page_count}")
    print(f"Metadata: {doc.metadata}")
    print("=" * 80)

    total_chars = 0
    pages_with_search_term = []

    for page_num, page in enumerate(doc, start=1):
        text = page.get_text("text")
        char_count = len(text.strip())
        total_chars += char_count

        # Check if search term is in this page
        if search_term and search_term.lower() in text.lower():
            pages_with_search_term.append(page_num)

        print(f"\n{'='*80}")
        print(f"PAGE {page_num} ({char_count} characters)")
        print("=" * 80)

        if search_term:
            # Only show pages containing the search term
            if search_term.lower() in text.lower():
                print(text)
            else:
                print(f"[Search term '{search_term}' not found on this page]")
        else:
            # Show first 1500 chars of each page
            if len(text) > 1500:
                print(text[:1500])
                print(f"\n... [truncated, {len(text) - 1500} more characters]")
            else:
                print(text if text.strip() else "[Empty page]")

    doc.close()

    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Total pages: {doc.page_count}")
    print(f"Total characters extracted: {total_chars}")

    if search_term:
        if pages_with_search_term:
            print(f"Pages containing '{search_term}': {pages_with_search_term}")
        else:
            print(f"WARNING: Search term '{search_term}' NOT FOUND in any page!")
            print("This could indicate:")
            print("  - The PDF is a scanned image (needs OCR)")
            print("  - The text uses special encoding")
            print("  - The section might be in a different format")


def main():
    parser = argparse.ArgumentParser(
        description="Extract and analyze text from a PDF file"
    )
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument(
        "--search", "-s",
        help="Search term to look for (e.g., '2.4' or 'Führung')",
        default=None
    )
    parser.add_argument(
        "--output", "-o",
        help="Output file to save extracted text",
        default=None
    )

    args = parser.parse_args()

    if args.output:
        # Redirect output to file
        with open(args.output, "w", encoding="utf-8") as f:
            original_stdout = sys.stdout
            sys.stdout = f
            extract_pdf_text(args.pdf_path, args.search)
            sys.stdout = original_stdout
        print(f"Output saved to: {args.output}")
    else:
        extract_pdf_text(args.pdf_path, args.search)


if __name__ == "__main__":
    main()

