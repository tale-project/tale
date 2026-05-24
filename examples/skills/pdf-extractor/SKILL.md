---
name: pdf-extractor
description: Extract text from a PDF file the user has attached to the conversation. Use when the user asks "what does this PDF say", "summarize this PDF", or otherwise wants to read PDF contents back. Runs a Python script in the platform sandbox.
packages:
  python:
    - pypdf
license: MIT
---

# PDF Extractor

You can extract text from a PDF the user attached to this thread.

## When to invoke

The user has attached a `.pdf` file (visible in the conversation attachments) AND wants you to read its content. Typical phrasings:

- "What does this PDF say?"
- "Summarize this for me"
- "Extract the section about X"

If the user attached a PDF but didn't ask about its content, **don't** invoke this skill — wait for an explicit ask.

## How to invoke

Call `skill_run({ skillSlug: "pdf-extractor", path: "scripts/extract.py" })`.

The script reads the PDF from `/workspace/output/<filename>.pdf` (the platform stages thread attachments there) and writes the extracted text to `/workspace/output/extracted.txt`. After the run completes, read the returned `extracted.txt` and answer the user's question from its content.

## After the run

- Confirm the returned `files` array contains `extracted.txt` and `success === true`. If not, surface the error to the user — don't pretend you read the PDF.
- Keep your reply grounded in the extracted text. Quote sparingly. If the text is too long for the reply, summarize and offer to drill in.
- If `runStderrPreview` mentions encryption or scanned-image PDFs, tell the user: this skill handles native-text PDFs only.
