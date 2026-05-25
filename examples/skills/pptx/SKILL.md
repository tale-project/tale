---
name: pptx
description: Create PowerPoint decks (.pptx) from a structured outline. Use any time the user asks for a slide deck, pitch deck, or presentation; says "make slides", "build a deck", "turn this into slides"; or attaches an outline they want rendered as a presentation. This skill creates from scratch — it does not read or edit existing .pptx files (the sandbox has no LibreOffice / markitdown).
recommended-packages:
  python:
    - python-pptx==1.0.2
license: MIT
---

# PPTX Skill

You build .pptx decks by writing a Python script into the thread workspace and executing it with `run_code`. This skill ships a reference implementation and a design catalog — **read them, then write your own script**.

## When to use

- "Make a 5-slide deck about Q3 results."
- "Turn this outline into slides."
- "Build a pitch deck for $TOPIC."

Don't use this skill to read or edit existing .pptx files — the sandbox can only create them.

## Workflow

1. **Read the reference implementation.** Call `read_skill_file({ skillSlug: "pptx", path: "scripts/example.py" })`. It shows the full python-pptx pattern: palette/font catalogs, background fills, accent bars, title slide, content slides, speaker notes.
2. **Read the design catalog.** Call `read_skill_file({ skillSlug: "pptx", path: "references/design.md" })` for the palette names, font pairings, and layout guidance. **Don't default to generic blue when the topic suggests a more specific palette.**
3. **Write your own generator script** with `file_write`. Hardcode the user's outline (title, slide titles, bullets, speaker notes) directly into the script — don't try to parse markdown unless the user attached a real `outline.md` to the thread. Pick a palette that matches the topic's mood.
4. **Execute it** with `run_code`, declaring `python-pptx==1.0.2` in `packages.python`. The script should write `deck.pptx` (or similar) into the workspace so the user can download it.
5. **Confirm the result.** Check that `run_code` reported success and the deck file appears in the workspace. If it failed, surface the error — don't pretend the deck exists.

## Worked example

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

The reference `scripts/example.py` is much fuller — copy the palette dict, the `add_background` / `add_accent_bar` / `style_run` helpers, and the title/content slide builders. You're not constrained to its markdown-parsing input mode; hardcode the user's outline directly.

## Notes

- One deck of < 50 slides finishes well under 5s. If you blow the 30s wall clock you're probably embedding huge images.
- To embed images or charts, extend the reference pattern — python-pptx supports both.
- If the user attached an actual `outline.md` and asked you to render it, you can either parse it inside your script (see the example's `parse_outline`) or just read the file yourself with `file_read` and inline the content into your generator.
