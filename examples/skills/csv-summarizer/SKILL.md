---
name: csv-summarizer
description: Summarize a CSV file the user attached to the thread — row count, column names, per-numeric-column mean/min/max. Stdlib-only Python, no extra packages. Use when the user asks to describe, count, or aggregate a tabular dataset.
license: MIT
---

# CSV Summarizer

You summarize CSVs by writing a small Python script into the thread workspace and executing it with `run_code`. The pattern is stdlib-only (`csv` + `statistics`) — no pip packages needed.

## When to use

- "Summarize this CSV."
- "How many rows are in this file?"
- "What's the average of the `revenue` column?"
- "What columns does this dataset have?"

The user attaches the CSV to the thread; you read its path from the workspace, not from the skill bundle.

## Workflow

1. **Read the reference implementation.** Call `read_skill_file({ skillSlug: "csv-summarizer", path: "scripts/example.py" })`. It shows the `csv.DictReader` + `statistics.fmean` pattern for row count, field names, and per-column numeric stats.
2. **Find the user's CSV in the workspace.** Use `file_list` to discover what they uploaded. The bundled `assets/sample.csv` is **reference data only** — it lives inside the skill bundle, not the thread workspace, and exists so you can sanity-check the example. Don't summarize it unless the user explicitly asks for a demo.
3. **Write your own summarizer script** with `file_write`. Adapt the example's logic to the user's actual file path and to whatever stats they asked for (median, group-by, percentile, etc.). The example only does mean/min/max — extend as needed.
4. **Execute it** with `run_code` (no packages needed — stdlib is enough). Write the result to a workspace file the user can download, or just print it to stdout and quote the output back.
5. **Quote the numbers exactly.** Don't paraphrase counts or stats — they come from the script.

## Worked example

```
file_list({})
// → sees user's "sales_2026.csv" in the workspace

file_write({
  path: "summarize.py",
  content: `
import csv, statistics
from pathlib import Path

rows = list(csv.DictReader(Path("sales_2026.csv").open(newline="", encoding="utf-8")))
print(f"Rows: {len(rows)}")
print(f"Columns: {', '.join(rows[0].keys())}")
for col in rows[0].keys():
    try:
        values = [float((r.get(col) or "").strip()) for r in rows if r.get(col)]
    except ValueError:
        continue
    if values:
        print(f"  {col}: mean={statistics.fmean(values):.3f} min={min(values):g} max={max(values):g}")
`,
})

run_code({ entryPath: "summarize.py" })
```

If the user wants a richer breakdown (group-by, histograms, correlations), extend the script — you have the full stdlib. For pandas-style work, declare `pandas` in `packages.python` and write idiomatic pandas instead.
