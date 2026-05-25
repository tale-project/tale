---
name: pptx
description: Create, edit, and inspect PowerPoint decks (.pptx). Use any time the user asks for a slide deck, pitch deck, or presentation; says "make slides", "build a deck", "turn this into slides"; attaches an outline they want rendered as a presentation; or attaches a .pptx they want edited or read. Default path is python-pptx for clean from-scratch decks; pptxgenjs (Node) is the alternative when the deck leans on charts, shadows, or icons; markitdown handles text extraction.
recommended-packages:
  python:
    - python-pptx==1.0.2
    - defusedxml==0.7.1
    - markitdown[pptx]==0.1.5
  node:
    - pptxgenjs@4.0.1
license: MIT
---

# PPTX Skill

Four flows live in this skill, each pointed at by its own reference doc.
Pick the row that matches the user's request, read the reference, then
write your generator/wrapper script and run it.

| Task                            | Reference                                                                                           | Sandbox runtime |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | --------------- |
| Create a deck from scratch      | this file + [scripts/example.py](scripts/example.py)                                                | Python          |
| Edit an existing .pptx template | [references/editing.md](references/editing.md) + [scripts/example_edit.py](scripts/example_edit.py) | Python          |
| Read .pptx text for content QA  | [references/reading.md](references/reading.md)                                                      | Python          |
| Build a chart/icon-heavy deck   | [references/pptxgenjs.md](references/pptxgenjs.md)                                                  | Node            |

For every flow, also read [references/design.md](references/design.md)
**before picking a palette** — defaulting to generic blue when the topic
suggests something else is the single most common failure mode.

## Visual QA caveat

The sandbox does not ship LibreOffice or Poppler, so the upstream
Anthropic skill's render-slides-to-JPG-then-look-at-them loop does not
work here. Substitute by running `markitdown` on the output for text-level
QA (see [references/reading.md](references/reading.md)) and quoting the
slide titles back to the user before declaring success.

---

## Workflow: create from scratch (python-pptx)

1. **Read the reference implementation.** Call
   `read_skill_file({ skillSlug: "pptx", path: "scripts/example.py" })`. It
   shows the full python-pptx pattern: palette/font catalogs, background
   fills, accent bars, title slide, content slides, speaker notes.
2. **Read the design catalog.** Call
   `read_skill_file({ skillSlug: "pptx", path: "references/design.md" })`
   for palette names, font pairings, and layout guidance. **Don't default
   to generic blue when the topic suggests a more specific palette.**
3. **Write your own generator script** with `file_write`. Hardcode the
   user's outline (title, slide titles, bullets, speaker notes) directly
   into the script — don't try to parse markdown unless the user attached
   a real `outline.md` to the thread. Pick a palette that matches the
   topic's mood.
4. **Execute it** with `run_code`, declaring `python-pptx==1.0.2` in
   `packages.python`. The script should write `deck.pptx` (or similar) into
   the workspace so the user can download it.
5. **Confirm the result.** Check that `run_code` reported success and the
   deck file appears in the workspace. If it failed, surface the error —
   don't pretend the deck exists.

### Worked example

```
file_write({
  path: "gen.py",
  content: `
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.util import Inches, Pt

OUTLINE = {
  "title": "Q3 Operations Review",
  "palette": ("1E2761", "CADCFC", "FFFFFF"),  # midnight-executive
  "slides": [
    {"title": "Headline numbers", "bullets": ["Revenue +14% QoQ", "Churn down to 2.1%"], "notes": "EU mid-market drove the lift."},
    {"title": "Risks", "bullets": ["Supply lead times volatile", "One Tier-1 renegotiating"]},
  ],
}
# ... build slides per the pattern in scripts/example.py ...
prs.save("deck.pptx")
`,
})

run_code({
  entryPath: "gen.py",
  packages: { python: ["python-pptx==1.0.2"] },
})
```

The reference `scripts/example.py` is much fuller — copy the palette dict,
the `add_background` / `add_accent_bar` / `style_run` helpers, and the
title/content slide builders. You're not constrained to its
markdown-parsing input mode; hardcode the user's outline directly.

---

## Workflow: edit an existing .pptx

The user attached a `.pptx` (template, prior deck) and wants slides
rewritten, added, or reordered. The pipeline is unpack → edit XML →
clean → pack, all in one wrapper script because each `run_code` call is
a fresh container.

Full workflow lives in [references/editing.md](references/editing.md);
the wrapper template is at [scripts/example_edit.py](scripts/example_edit.py).
You'll need to `file_write` the four vendored helpers
(`scripts/__init__.py`, `scripts/clean.py`, `scripts/office/unpack.py`,
`scripts/office/pack.py`) plus your wrapper into the workspace, then
`run_code` with `packages.python = ["python-pptx==1.0.2", "defusedxml==0.7.1"]`.

**Always pass `validate=False` to `pack()`** — the validators package is
not shipped.

---

## Workflow: read .pptx text

Use `markitdown[pptx]` for text-only extraction. See
[references/reading.md](references/reading.md). One `file_write` + one
`run_code` and you've got a Markdown rendering of every slide for content
QA or template scouting.

---

## Workflow: chart/icon-heavy decks (pptxgenjs)

Node 24 + pptxgenjs is the better fit when the deck has:

- multiple chart types (bar, line, pie, doughnut, radar)
- icons (via react-icons + sharp)
- shadows, transparency, gradient-image backgrounds
- slide masters / placeholders

See [references/pptxgenjs.md](references/pptxgenjs.md) for the full
tutorial and pitfalls list.

---

## Notes

- One deck of < 50 slides finishes well under 5 s. If you blow the 30 s
  wall clock you're probably embedding huge images or making many remote
  fetches.
- To embed images or charts in the python-pptx path, extend the reference
  pattern — python-pptx supports both.
- If the user attached an actual `outline.md` and asked you to render it,
  you can either parse it inside your script (see the example's
  `parse_outline`) or just read the file yourself with `file_read` and
  inline the content into your generator.
