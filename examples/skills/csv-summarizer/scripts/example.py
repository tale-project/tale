#!/usr/bin/env python3
"""Summarize the bundled assets/sample.csv into ./summary.txt.

Stdlib only — runs anywhere the platform sandbox runs Python 3, no
package declarations needed. The sandbox stages skill bundle files into
the working directory, so relative `assets/sample.csv` resolves to the
copy shipped with this skill bundle.
"""

import csv
import statistics
import sys
from pathlib import Path

DATA_PATH = Path("assets/sample.csv")
OUT_PATH = Path("summary.txt")


def main() -> int:
    if not DATA_PATH.exists():
        sys.stderr.write(f"missing bundled dataset: {DATA_PATH}\n")
        return 1

    with DATA_PATH.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        rows = list(reader)
        fieldnames = list(reader.fieldnames or [])

    if not rows:
        OUT_PATH.write_text("Dataset is empty.\n", encoding="utf-8")
        return 0

    numeric_stats: list[str] = []
    for col in fieldnames:
        values: list[float] = []
        for row in rows:
            raw = (row.get(col) or "").strip()
            if not raw:
                continue
            try:
                values.append(float(raw))
            except ValueError:
                values = []
                break
        if values:
            numeric_stats.append(
                f"  {col}: mean={statistics.fmean(values):.3f} "
                f"min={min(values):g} max={max(values):g}"
            )

    lines = [
        f"Rows: {len(rows)}",
        f"Columns ({len(fieldnames)}): {', '.join(fieldnames)}",
    ]
    if numeric_stats:
        lines.append("Numeric columns:")
        lines.extend(numeric_stats)
    else:
        lines.append("No purely-numeric columns detected.")

    OUT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
