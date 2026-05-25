#!/usr/bin/env python3
"""Edit an existing .pptx in-process inside a Tale run_code sandbox.

The whole unpack -> edit -> clean -> pack flow lives in a single script
because each run_code call is a fresh container -- shell pipelines that
span multiple commands do not survive.

The agent should:
  1. file_write this script (after adapting OUTLINE_EDITS to the task) plus
     the four vendored helpers under /workspace/code/scripts/:
       scripts/__init__.py
       scripts/clean.py
       scripts/add_slide.py
       scripts/office/unpack.py
       scripts/office/pack.py
  2. run_code({
       entryPath: "edit.py",
       packages: { python: ["python-pptx==1.0.2", "defusedxml==0.7.1"] }
     })

The user's template lands in /workspace/output/<filename>.pptx as a chat
upload; the edited deck is written back to /workspace/output/edited.pptx.
"""

from __future__ import annotations

import re
import shutil
import sys
import tempfile
from pathlib import Path

# Make the vendored helpers importable. file_write placed them under
# /workspace/code/scripts/, which is the script's own directory tree.
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "office"))

from clean import clean_unused_files  # noqa: E402
from office.pack import pack  # noqa: E402
from office.unpack import unpack  # noqa: E402

WORKDIR = Path("/workspace/output")


# Adapt this for the actual task. Each entry is a (filename_glob, regex,
# replacement) tuple applied to every slide XML matching the glob.
OUTLINE_EDITS: list[tuple[str, str, str]] = [
    # Example: replace the first <a:t>Old Title</a:t> on slide 1
    # ("ppt/slides/slide1.xml", r"<a:t>Old Title</a:t>", "<a:t>Edited</a:t>"),
]


def find_template() -> Path:
    """Pick the first .pptx in /workspace/output/ as the template.

    The agent normally narrows this down by knowing the upload filename;
    this helper is a fallback for when the wrapper is run unmodified.
    """
    candidates = sorted(WORKDIR.glob("*.pptx"))
    if not candidates:
        sys.stderr.write(f"No .pptx found in {WORKDIR}\n")
        sys.exit(1)
    # Skip our own output file if a previous run left one behind.
    for path in candidates:
        if path.name != "edited.pptx":
            return path
    return candidates[0]


def apply_edits(unpacked: Path, edits: list[tuple[str, str, str]]) -> int:
    """Apply (path_glob, regex, replacement) edits across the unpacked tree.

    Returns the number of substitutions made. Use distinctive regex
    patterns -- a too-loose pattern will rewrite text you didn't intend.
    """
    total = 0
    for path_glob, pattern, replacement in edits:
        for xml_path in unpacked.rglob(
            path_glob.split("/")[-1] if "/" in path_glob else path_glob
        ):
            # Re-anchor to the glob's directory if it had one.
            rel = xml_path.relative_to(unpacked).as_posix()
            if "/" in path_glob and not rel.endswith(path_glob.split("/", 1)[1]):
                if rel != path_glob:
                    continue
            text = xml_path.read_text(encoding="utf-8")
            new_text, n = re.subn(pattern, replacement, text)
            if n:
                xml_path.write_text(new_text, encoding="utf-8")
                total += n
                sys.stdout.write(f"  edited {rel}: {n} substitution(s)\n")
    return total


def main() -> int:
    template = find_template()
    output = WORKDIR / "edited.pptx"
    sys.stdout.write(f"Editing {template.name} -> {output.name}\n")

    with tempfile.TemporaryDirectory() as tmp:
        unpacked = Path(tmp) / "unpacked"
        _, msg = unpack(str(template), str(unpacked))
        sys.stdout.write(f"  {msg}\n")
        if "Error" in msg:
            return 1

        n_edits = apply_edits(unpacked, OUTLINE_EDITS)
        if not OUTLINE_EDITS:
            sys.stdout.write(
                "  (no edits configured -- script will repack unchanged)\n"
            )
        else:
            sys.stdout.write(f"  applied {n_edits} edit(s)\n")

        removed = clean_unused_files(unpacked)
        if removed:
            sys.stdout.write(f"  cleaned {len(removed)} orphaned file(s)\n")

        # validate=False is REQUIRED -- the validators package is not shipped.
        _, msg = pack(str(unpacked), str(output), validate=False)
        sys.stdout.write(f"  {msg}\n")
        if "Error" in msg:
            return 1

    # Quick content QA so the agent has something to quote back to the user.
    # Move this into a separate run_code with markitdown[pptx] if you want
    # full slide text rather than just file size.
    size = output.stat().st_size
    sys.stdout.write(f"Wrote {output} ({size} bytes)\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
