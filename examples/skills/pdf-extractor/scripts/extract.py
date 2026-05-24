"""Extract text from every PDF staged in /workspace/output/.

Reads each `*.pdf` file under the staged output dir and writes a single
`extracted.txt` containing all pages, with `--- <filename> page N ---`
banners between sections so downstream summarizers can correlate text
back to its source.
"""

from __future__ import annotations

import sys
from pathlib import Path

from pypdf import PdfReader

WORKSPACE = Path("/workspace/output")


def extract(pdf_path: Path) -> str:
    reader = PdfReader(str(pdf_path))
    if reader.is_encrypted:
        return f"[skipped: {pdf_path.name} is encrypted]"
    chunks: list[str] = []
    for i, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        chunks.append(f"--- {pdf_path.name} page {i} ---\n{text.strip()}")
    return "\n\n".join(chunks)


def main() -> int:
    pdfs = sorted(WORKSPACE.glob("*.pdf"))
    if not pdfs:
        sys.stderr.write(
            "No PDF found in /workspace/output/. The platform stages thread "
            "attachments here; ensure the user attached a .pdf file.\n",
        )
        return 1
    out = WORKSPACE / "extracted.txt"
    text = "\n\n".join(extract(p) for p in pdfs)
    out.write_text(text, encoding="utf-8")
    sys.stdout.write(f"Extracted {len(pdfs)} PDF(s) into {out.name}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
