---
name: python
description: Conventions for Python in this repo — ruff (format + lint), type hints, pydantic/dataclasses, pathlib, f-strings, specific-exception handling, context managers, and uv for deps/runs. Read before writing or editing any `.py` file (today these live under `examples/*/skills/pptx/scripts/`). Shell scripts have their own guide: bash.
---

# python

Python is a _minor_ language here — the repo is TypeScript-first (see [`typescript`](../typescript/SKILL.md)). The only `.py` source today is the bundled **PPTX agent skill** under [`examples/default/skills/pptx/scripts/`](../../../examples/default/skills/pptx/scripts/) (mirrored in `examples/test/`); the runtime that _executes_ user/agent Python lives in [`services/sandbox-runtime/`](../../../services/sandbox-runtime/) but is itself shell + Bun, with no checked-in `.py` source. There is no root `pyproject.toml`, `requirements.txt`, or `ruff.toml` — tooling config is editor-level. Keep this skill honest to that small surface; don't invent a packaging story the repo doesn't have.

## When this applies

Editing or adding any `.py` file — in practice the pptx skill scripts above. If you're touching the sandbox _launch_ path (`entrypoint.sh`, Dockerfile) rather than Python source, that's [`bash`](../bash/SKILL.md) / [`docker`](../docker/SKILL.md).

## The rules

- **Format and lint with ruff.** `ruff format` runs automatically on save: the PostToolUse edit hook ([`.claude/hooks/format.sh:17`](../../../.claude/hooks/format.sh)) runs `uv run ruff format` on every edited `.py`, and VS Code uses the `charliermarsh.ruff` formatter ([`.vscode/settings.json`](../../../.vscode/settings.json)). Don't hand-format; let ruff own style. Run `uv run ruff check` for lint before calling a change done.
- **Type-hint everything.** Annotate params and returns, including container generics — e.g. `def get_slides(unpacked_dir: Path) -> set[str]:` and `-> list[str]` / `-> None` ([`scripts/clean.py:27`](../../../examples/default/skills/pptx/scripts/clean.py)). Use built-in generics (`list[str]`, `set[str]`), not the legacy `typing.List`.
- **Never a bare `except:`, and never silently swallow.** Catch the specific exception you expect and _do_ something with it. Bare `except Exception: pass` ([`base.py:145`](../../../examples/default/skills/pptx/scripts/office/validators/base.py)) is a smell — the existing code that does this is best-effort repair, not a template. Prefer narrow catches like `except (OSError, ValueError):` / `except lxml.etree.XMLSyntaxError as e:` and surface the error (collect it, log it to `stderr`, or re-raise). Reviewer-caught.
- **`pathlib`, not `os.path`.** Build and resolve paths with `Path`: `Path(__file__).parent / "schemas"`, `unpacked_dir / "ppt" / "presentation.xml"`, `.rglob("*.xml")`, `.relative_to(...)`, `.read_text(encoding="utf-8")` ([`base.py:98`](../../../examples/default/skills/pptx/scripts/office/validators/base.py)). No `os.path.join` / `os.listdir` in new code.
- **f-strings for interpolation.** `print(f"Removed {len(removed)} unreferenced files:")` — never `%`-formatting or `str.format`. Send diagnostics to `stderr` (`file=sys.stderr`) and exit non-zero on failure ([`clean.py:279`](../../../examples/default/skills/pptx/scripts/clean.py)).
- **Context managers for resources.** Open files, temp dirs, and zips with `with` so they always close: `with open(schema_path, "rb") as f:`, `with tempfile.TemporaryDirectory() as temp_dir:`, `with zipfile.ZipFile(...) as zip_ref:` ([`base.py:763`,`805`](../../../examples/default/skills/pptx/scripts/office/validators/base.py)). Never leak a bare `open()`.
- **Structured data → pydantic models or dataclasses.** When you carry a record with named fields, define a `@dataclass` (or a pydantic `BaseModel` if you need validation/serialization) instead of passing dicts/tuples around. The existing scripts predate this and lean on tuples/dicts — don't copy that for new structured shapes.
- **Run via uv.** Use `uv run <script>.py` / `uv run ruff …` so the toolchain is pinned and reproducible, matching the edit hook. Don't assume a global `python` or `pip`.
- **Guard module entry.** Put CLI/argv handling behind `if __name__ == "__main__":`; library modules that should never run standalone raise instead (`raise RuntimeError("This module should not be run directly.")`, [`base.py:854`](../../../examples/default/skills/pptx/scripts/office/validators/base.py)).
- **Security: parse XML defensively.** The pptx scripts use `defusedxml` for untrusted XML to block entity-expansion attacks ([`clean.py:21`](../../../examples/default/skills/pptx/scripts/clean.py)). Keep that for any external/untrusted input — see [`security`](../security/SKILL.md).

## Patterns

Specific exception + pathlib + f-string + context manager, in one shape ([`clean.py`](../../../examples/default/skills/pptx/scripts/clean.py) style):

```python
from pathlib import Path

def referenced_targets(rels_file: Path, root: Path) -> set[Path]:
    refs: set[Path] = set()
    dom = defusedxml.minidom.parse(str(rels_file))
    for rel in dom.getElementsByTagName("Relationship"):
        target = rel.getAttribute("Target")
        if not target:
            continue
        try:
            refs.add((rels_file.parent.parent / target).resolve().relative_to(root))
        except ValueError:        # outside the tree — skip, don't `except:`
            continue
    return refs
```

```python
# ❌ swallows everything, hides real bugs
try:
    do_work()
except:            # bare except — never
    pass

# ✅ catch what you expect, surface the rest
try:
    do_work()
except (OSError, ValueError) as e:
    print(f"  skipped {path}: {e}", file=sys.stderr)
```

## Verify

`uv run ruff format <file>.py && uv run ruff check <file>.py`, then run the script the way the skill invokes it (`uv run python <script>.py <args>`) and confirm the output. See [`verify`](../verify/SKILL.md) and [`definition-of-done`](../definition-of-done/SKILL.md).
