---
name: csv-summarizer
description: Summarize a small tabular dataset bundled with this skill. Use when the user asks to count rows, average a column, or describe the columns of the bundled sample. Runs a stdlib-only Python script in the platform sandbox.
license: MIT
---

# CSV Summarizer

This skill demonstrates a complete `skill_run` workflow that operates on a file bundled with the skill itself — no chat attachments, no external dependencies.

## When to invoke

The user is asking about the bundled sample dataset:

- "Summarize the sample CSV"
- "How many rows are in the sample data?"
- "What columns does the bundled file have?"

If the user wants to summarize their own attached CSV instead, this skill is the wrong fit — the bundled script only sees files inside the skill bundle, not chat uploads.

## How to invoke

Call `skill_run({ skillSlug: "csv-summarizer", path: "scripts/summarize.py" })`.

The script reads `assets/sample.csv` from the skill bundle (the sandbox stages bundle files into the working directory), then writes a plain-text summary to `summary.txt` with row count, column names, and per-numeric-column mean and range.

## After the run

- Confirm `success === true` and that `files` contains `summary.txt`. If not, surface the error rather than guessing.
- Quote the summary text directly to the user. The numbers come from the script — don't paraphrase counts.
- If the user wants a different statistic (median, percentile, group-by) tell them to extend the script under `scripts/summarize.py`; the skill is intentionally minimal so it stays readable.
