---
name: pdf-extractor
description: Extract text from one or more PDFs the user attached to the conversation. Use when the user asks "what does this PDF say", "summarize this PDF", or otherwise wants to read PDF contents back. Handles native-text PDFs only — encrypted and scanned-image PDFs are skipped.
recommended-packages:
  python:
    - pypdf==5.1.0
license: MIT
---

# PDF Extractor

You extract PDF text by writing a Python script into the thread workspace and executing it with `run_code` against `pypdf`. The user uploads PDFs to the thread; you read them from the workspace.

## When to use

The user has attached one or more `.pdf` files **and** wants you to read their content. Typical phrasings:

- "What does this PDF say?"
- "Summarize this for me."
- "Extract the section about X."

If a PDF is attached but the user hasn't asked about its content, don't pre-emptively extract — wait for an explicit request.

## Workflow

1. **Read the reference implementation.** Call `read_skill_file({ skillSlug: "pdf-extractor", path: "scripts/example.py" })`. It shows the `pypdf.PdfReader` + page-banner pattern, with skip markers for encrypted/broken PDFs.
2. **Find the PDFs in the workspace.** Use `file_list` to see what's actually attached. The example globs `*.pdf` / `*.PDF`; replicate that or list the user's filenames directly.
3. **Write your own extraction script** with `file_write`. Adapt the example to glob the workspace, run pypdf over each PDF, and write combined text to an output file (e.g. `extracted.txt`) with `--- <filename> page N ---` banners so you can attribute quotes back.
4. **Execute it** with `run_code`, declaring `pypdf==5.1.0` in `packages.python`.
5. **Read the output and answer.** Use `file_read` on `extracted.txt`, then ground your reply in its content. Quote sparingly. If a PDF was skipped (encrypted / scanned-image), tell the user — don't pretend you read it.

## Worked example

```
file_list({})
// → sees "report.pdf" in the workspace

file_write({
  path: "extract.py",
  content: `
import glob
from pathlib import Path
from pypdf import PdfReader
from pypdf.errors import PdfReadError

parts = []
for path in sorted(glob.glob("*.pdf") + glob.glob("*.PDF")):
    p = Path(path)
    try:
        reader = PdfReader(str(p))
    except PdfReadError as exc:
        parts.append(f"[skipped: {p.name} — {exc}]")
        continue
    if reader.is_encrypted:
        parts.append(f"[skipped: {p.name} is encrypted]")
        continue
    for i, page in enumerate(reader.pages, start=1):
        parts.append(f"--- {p.name} page {i} ---\\n{page.extract_text() or ''}")

Path("extracted.txt").write_text("\\n".join(parts), encoding="utf-8")
`,
})

run_code({
  entryPath: "extract.py",
  packages: { python: ["pypdf==5.1.0"] },
})

file_read({ path: "extracted.txt" })
```

Scanned-image PDFs return empty page text (pypdf doesn't OCR). If the user needs OCR, tell them this skill doesn't cover it.
