---
name: pptx
description: Create PowerPoint decks (.pptx) from a structured outline. Use any time the user asks for a slide deck, pitch deck, or presentation; says "make slides", "build a deck", "turn this into slides"; or attaches an outline they want rendered as a presentation. Returns the .pptx as a downloadable attachment. This skill creates from scratch — it does not read or edit existing .pptx files (the platform sandbox has no LibreOffice / markitdown).
packages:
  python:
    - python-pptx==1.0.2
license: MIT
---

# PPTX Skill

## When to invoke

The user wants a slide deck, e.g.:

- "Make a 5-slide deck about Q3 results."
- "Turn this outline into slides."
- "Build a pitch deck for $TOPIC."
- An `outline.md` is attached and they want it rendered.

Do **not** invoke for:

- Reading or summarizing an existing `.pptx` — the sandbox cannot extract text from PowerPoint files. Tell the user to copy/paste the content or export to markdown first.
- Editing an existing `.pptx` — same constraint. This skill is create-from-scratch only.
- Image-heavy decks the user specifies by reference image — the script only places text, shapes, and colors. To embed images, extend `scripts/generate.py`.

## How to invoke

```
skill_run({ skillSlug: "pptx", path: "scripts/generate.py" })
```

The script writes `/workspace/output/deck.pptx`; the platform harvests it back to the thread as a downloadable attachment.

### Input modes

The script auto-detects which input it has:

1. **Outline attached** — first `outline.md` / `*.outline.md` in `/workspace/output/` is parsed. `# H1` becomes the deck title, each `## H2` starts a new slide, list items become bullets, prose between bullets and the next H2 becomes speaker notes.
2. **No outline** — falls back to a 3-slide demo so a cold call still returns a visible artifact. Only rely on this if the user explicitly asks for a sample.

Outline example:

```markdown
# Q3 Operations Review

## Headline numbers

- Revenue +14% QoQ
- Churn down to 2.1%
- Two enterprise renewals closed

Driven primarily by the EU mid-market motion the team rebuilt in July.

## Risks

- Supply lead times still volatile
- One Tier-1 customer renegotiating
```

### Picking a palette

The script reads an optional `palette` and `font` selection from a top-level frontmatter block on `outline.md` (YAML):

```markdown
---
palette: midnight-executive
font: georgia-calibri
---

# Q3 Operations Review

## Headline numbers

...
```

If omitted, the script picks `midnight-executive` (navy + ice blue, white accent) and `georgia-calibri`. Read [references/design.md](references/design.md) for the full set of palettes, font pairings, and slide layout patterns the script supports. **Don't default to generic blue when the topic suggests a more specific palette.** Pick a palette that matches the topic's mood.

## After the run

- Confirm `success === true` and `files` contains `deck.pptx`. If not, surface the error from `stderrPreview` — do not pretend the deck was generated.
- Quote the slide titles from `stdoutPreview` back to the user so they can spot-check the structure before opening the file.
- If the demo fallback was used (no outline attached) and the user did not ask for a sample, follow up: "I produced a sample deck. To get one on your topic, share an outline with `# Title` / `## Slide`, or paste it inline and I'll attach it."
- If the user wanted a richer deck (charts, images, branded layouts) tell them to extend `scripts/generate.py` — the skill is intentionally minimal so the bundle stays readable.

## Sandbox constraints (read this before extending)

- Python 3.12 with **only `python-pptx==1.0.2`** declared. To add fonts / images / charts you may need extra packages — add them to the SKILL.md `packages.python` list; `skill_run` refuses any package not declared here.
- No LibreOffice, no `markitdown`, no `pdftoppm` — the reference design's visual-QA loop (render to images, inspect with a subagent) does not work in this sandbox. If you need that workflow, run python-pptx locally.
- 30s default wall clock (300s max). One deck of < 50 slides finishes well under 5s; if you blow the budget you're probably embedding huge images.
- 1 GB memory cap.
- Files written outside `/workspace/output/` are not returned to the thread.
