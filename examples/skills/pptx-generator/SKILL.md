---
name: pptx-generator
description: Generate a PowerPoint deck (.pptx) from a structured outline. Use when the user asks for a slide deck, "make slides for…", "build a presentation about X", or attaches an outline they want turned into slides. Runs a Python script in the platform sandbox and returns the .pptx as a downloadable attachment.
packages:
  python:
    - python-pptx==1.0.2
license: MIT
---

# PowerPoint Generator

You can produce a `.pptx` deck from a structured outline and return it to the user as an attachment.

## When to invoke

The user asks for a slide deck, e.g.:

- "Make a 5-slide deck about Q3 results."
- "Turn this outline into slides."
- "Build a quick intro presentation about $TOPIC."

Do **not** invoke this skill for:

- Long-form documents (use markdown / docx skills if available).
- Image-heavy decks the user has specified by image — this skill only places text. Embed images by extending `scripts/generate.py`.

## How to invoke

There are two input modes — the script detects which to use automatically:

### Mode 1: Outline file attached

If the user attached `outline.md` (or any `*.outline.md` file) to the thread, the platform stages it into `/workspace/output/`. The script parses it as:

- Document `# H1` → deck title (first one wins; the rest are ignored).
- Each `## H2` → a new slide title.
- Bullet list items below an H2 → bullet content for that slide.
- Any prose paragraph between bullets and the next H2 → speaker notes for the current slide.

Example outline:

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

### Mode 2: No outline attached

The script writes a small demo deck (3 slides) so the user gets a concrete artifact back even on a cold call. Use this only when the user explicitly says "show me a sample" or "demo it" — otherwise prefer mode 1 so the deck reflects the user's intent.

### Tool call

```
skill_run({ skillSlug: "pptx-generator", path: "scripts/generate.py" })
```

The script writes `/workspace/output/deck.pptx`. The platform uploads any file under `/workspace/output/` back to the thread, so the user receives the deck as a downloadable attachment.

## After the run

- Confirm `success === true` and that `files` contains `deck.pptx`. If not, surface the error rather than guessing.
- Tell the user how many slides were produced and quote the slide titles back — this lets them spot-check the structure before opening the file.
- If you used the demo fallback (no outline attached) and the user did not explicitly ask for a demo, prompt them: "I produced a sample deck. To get a deck on a specific topic, share an outline (`# Title` / `## Slide`)."
- Encrypted or oversized outline files surface as a Python error in `stderrPreview` — relay the message, do not pretend the deck was generated.
