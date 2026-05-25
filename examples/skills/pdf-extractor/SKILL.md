---
name: pdf-extractor
description: Extract text from every PDF attached to the conversation. Use when the user asks "what does this PDF say", "summarize this PDF", or otherwise wants to read PDF contents back. Runs a Python script in the platform sandbox.
packages:
  python:
    - pypdf==5.1.0
license: MIT
---

# PDF Extractor

You can extract text from every PDF the user attached to this thread.

## When to invoke

The user has attached one or more `.pdf` files (visible in the conversation attachments) AND wants you to read their content. Typical phrasings:

- "What does this PDF say?"
- "Summarize this for me"
- "Extract the section about X"

If the user attached a PDF but didn't ask about its content, **don't** invoke this skill — wait for an explicit ask.

## How to invoke

Call `skill_run({ skillSlug: "pdf-extractor", path: "scripts/extract.py" })`.

The platform stages every chat-uploaded file on this thread into `/workspace/output/<filename>` before the script runs (see `skill_run`'s **INPUT FILES** section). The script globs `/workspace/output/*.pdf`, extracts text from each, and writes the combined output to `/workspace/output/extracted.txt`, with `--- <filename> page N ---` banners between sections so you can attribute quotes back to the right document. After the run completes, read the returned `extracted.txt` and answer the user's question from its content.

## After the run

- Confirm the returned `files` array contains `extracted.txt` and `success === true`. If not, surface the error to the user — don't pretend you read the PDF.
- Keep your reply grounded in the extracted text. Quote sparingly. If the text is too long for the reply, summarize and offer to drill in.
- Encrypted PDFs are listed in `extracted.txt` as `[skipped: <filename> is encrypted]`. Tell the user this skill handles native-text PDFs only and skips encrypted/scanned-image ones.
- If no PDF was attached, the run will write `extracted.txt` with a one-line `(no PDF files attached)` marker rather than a misleading empty result.
