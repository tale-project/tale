#!/usr/bin/env python3
"""Extract text from every PDF staged in /workspace/output/.

The platform's `skill_run` tool stages all chat-uploaded attachments
into /workspace/output/ before this script runs (see the platform's
`stageThreadAttachments` path in `node_only/sandbox/internal_actions.ts`).
We glob there, run pypdf over each PDF, and write the combined text
back to /workspace/output/extracted.txt — the sandbox harvests every
file in that directory, so the LLM gets the result without an
explicit upload step.
"""

import glob
import sys
from pathlib import Path

try:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError
except ImportError as e:
    sys.stderr.write(f"pypdf import failed: {e}\n")
    sys.exit(1)

WORKDIR = Path("/workspace/output")
OUT_PATH = WORKDIR / "extracted.txt"


def extract_one(path: Path) -> str:
    """Return text for one PDF, with page banners. Encrypted/broken PDFs
    return a single-line skip marker so the LLM can tell the user."""
    try:
        reader = PdfReader(str(path))
    except PdfReadError as exc:
        return f"[skipped: {path.name} could not be parsed — {exc}]\n"
    if reader.is_encrypted:
        return f"[skipped: {path.name} is encrypted]\n"

    chunks: list[str] = []
    for i, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception as exc:  # pypdf raises various errors per page
            chunks.append(
                f"--- {path.name} page {i} ---\n[page extraction failed: {exc}]\n"
            )
            continue
        chunks.append(f"--- {path.name} page {i} ---\n{text}\n")
    if not chunks:
        return f"[skipped: {path.name} has no extractable pages]\n"
    return "".join(chunks)


def main() -> int:
    pdfs = sorted(Path(p) for p in glob.glob(str(WORKDIR / "*.pdf")))
    # Also accept .PDF for case-insensitive matches — some upload paths
    # preserve original casing.
    pdfs += sorted(Path(p) for p in glob.glob(str(WORKDIR / "*.PDF")))
    # De-duplicate (in case the glob doubled up on a case-insensitive FS).
    pdfs = sorted(set(pdfs))

    if not pdfs:
        OUT_PATH.write_text("(no PDF files attached)\n", encoding="utf-8")
        return 0

    parts: list[str] = []
    for pdf_path in pdfs:
        parts.append(extract_one(pdf_path))
    OUT_PATH.write_text("\n".join(parts), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
