---
name: python
description: Conventions for the repo's only Python — ruff (format + lint), full type hints, pathlib over os.path, f-strings, specific-exception handling, context managers, defusedxml for untrusted XML, and uv to run. Read before writing or editing any `.py` file; today these live under `examples/{default,test}/skills/pptx/scripts/` (the bundled PPTX agent skill). Shell scripts: bash.
---

# python

Python is a _minor_ language here — the repo is TypeScript-first (see
[`typescript`](../typescript/SKILL.md)). The only `.py` source is the bundled **PPTX agent skill**
under [`examples/default/skills/pptx/scripts/`](../../../examples/default/skills/pptx/scripts/),
mirrored byte-for-byte in [`examples/test/skills/pptx/scripts/`](../../../examples/test/skills/pptx/scripts/).
There is **no** root `pyproject.toml`, `requirements.txt`, or `ruff.toml` — tooling config is
editor-level only. The sandbox that _executes_ agent Python lives in
[`services/sandbox-runtime/`](../../../services/sandbox-runtime/) but is itself shell + Bun with no
checked-in `.py`. Keep this skill honest to that small surface; don't invent a packaging story the
repo doesn't have.

## When this applies

Editing or adding any `.py` file — in practice the pptx skill scripts above (edit both the `default`
and `test` mirrors to keep them in sync). Touching the sandbox _launch_ path (`entrypoint.sh`,
`Dockerfile`) rather than Python source is [`bash`](../bash/SKILL.md) / [`docker`](../docker/SKILL.md).

## The rules

- **Format and lint with ruff.** The PostToolUse hook runs `uv run ruff format` on every edited `.py`
  ([`.claude/hooks/format.sh:17`](../../../.claude/hooks/format.sh)), and VS Code uses the
  `charliermarsh.ruff` formatter ([`.vscode/settings.json`](../../../.vscode/settings.json)). Don't
  hand-format. Run `uv run ruff check` for lint before calling a change done.
- **Run via uv.** `uv run <script>.py` / `uv run ruff …` so the toolchain is pinned and reproducible,
  matching the hook. Don't assume a global `python` or `pip`.
- **Type-hint everything**, including container generics — `def get_slides_in_sldidlst(unpacked_dir:
Path) -> set[str]:` ([`clean.py:27`](../../../examples/default/skills/pptx/scripts/clean.py)). Use
  built-in generics (`list[str]`, `set[str]`), not legacy `typing.List`.
- **`pathlib`, not `os.path`.** Build and resolve with `Path`: `Path(__file__).parent.parent /
"schemas"`, `.rglob("*.xml")`, `.relative_to(…)`, `.read_text(encoding="utf-8")`
  ([`office/validators/base.py:98`](../../../examples/default/skills/pptx/scripts/office/validators/base.py)).
  No `os.path.join` / `os.listdir` in new code. Why: `Path` is composable, OS-agnostic, and harder to
  misjoin.
- **Never a bare `except:`, never silently swallow.** Catch the specific exception and _act_ — collect
  it, log to `stderr`, or re-raise. The `except Exception: pass` at
  [`base.py:145`](../../../examples/default/skills/pptx/scripts/office/validators/base.py) is
  best-effort XML repair, **not** a template. Prefer `except (OSError, ValueError):` /
  `except lxml.etree.XMLSyntaxError as e:`. Reviewer-caught.
- **Context managers for resources** so they always close: `with open(schema_path, "rb") as …:`,
  `with tempfile.TemporaryDirectory() as …:`, `with zipfile.ZipFile(…) as …:`
  ([`base.py:763`,`805`,`808`](../../../examples/default/skills/pptx/scripts/office/validators/base.py)).
  Never leak a bare `open()`.
- **f-strings for interpolation**, never `%` or `str.format`. Send diagnostics to `stderr`
  (`file=sys.stderr`) and `sys.exit(1)` on failure
  ([`clean.py:279`](../../../examples/default/skills/pptx/scripts/clean.py)).
- **Parse untrusted XML with `defusedxml`** to block entity-expansion (billion-laughs) attacks —
  `import defusedxml.minidom` ([`clean.py:21`](../../../examples/default/skills/pptx/scripts/clean.py)).
  Keep it for any external input. See [`security`](../security/SKILL.md).
- **Guard module entry.** CLI/argv handling behind `if __name__ == "__main__":`; a library module
  that must never run standalone raises instead — `raise RuntimeError("This module should not be run
directly.")` ([`base.py:854`](../../../examples/default/skills/pptx/scripts/office/validators/base.py)).
- **Structured records → `@dataclass` or pydantic `BaseModel`** (the latter when you need
  validation/serialization), not bare dicts/tuples. The existing scripts predate this and lean on
  tuples — don't copy that for new shapes. Reviewer-caught.

## Patterns

Specific exception + pathlib + defusedxml in one shape
([`clean.py`](../../../examples/default/skills/pptx/scripts/clean.py) style):

```python
from pathlib import Path
import defusedxml.minidom

def referenced_targets(rels_file: Path, root: Path) -> set[Path]:
    refs: set[Path] = set()
    dom = defusedxml.minidom.parse(str(rels_file))
    for rel in dom.getElementsByTagName("Relationship"):
        target = rel.getAttribute("Target")
        if not target:
            continue
        try:
            refs.add((rels_file.parent.parent / target).resolve().relative_to(root))
        except ValueError:        # outside the tree — skip, never a bare except
            continue
    return refs
```

```python
# ❌ swallows everything, hides real bugs
try:
    do_work()
except:
    pass

# ✅ catch what you expect, surface the rest
try:
    do_work()
except (OSError, ValueError) as e:
    print(f"  skipped {path}: {e}", file=sys.stderr)
```
