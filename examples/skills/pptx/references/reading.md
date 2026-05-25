# Reading existing .pptx files

The sandbox does not ship `markitdown` as a CLI by default — but the
`markitdown[pptx]` PyPI package installs cleanly. Use it for text-level
content QA on a user-uploaded `.pptx` (slide text, ordering, placeholder
sniffing) or as a final check after editing a deck.

## Workflow

```
file_write({
  path: "extract.py",
  content: `
import subprocess, sys
res = subprocess.run(
  [sys.executable, "-m", "markitdown", "/workspace/output/template.pptx"],
  capture_output=True, text=True, check=True,
)
sys.stdout.write(res.stdout)
`,
})

run_code({
  entryPath: "extract.py",
  packages: { python: ["markitdown[pptx]==0.1.5"] },
})
```

`markitdown` prints a Markdown rendering of the deck: each slide becomes a
section, text frames become paragraphs, tables become Markdown tables.
Notes-page text is included.

## What to use this for

- **Content QA after editing.** After you pack the edited deck, re-run
  markitdown on the output and grep for leftover placeholder text
  (`xxxx`, `lorem`, "Click to add title"). Surface any hit before
  declaring success.
- **Template scouting.** Before editing, run markitdown on the source to
  see the slide ordering, placeholder names, and the language used.
- **Title-quoting.** Echo back the extracted slide titles to the user as
  a confirmation step — they spot wrong order / typos better than you do.

## What this does NOT cover

- **Visual QA.** markitdown extracts text only. Layout collisions, image
  overflow, low-contrast text — none of these are visible. The upstream
  skill uses `soffice` + `pdftoppm` to render slides as JPGs and sends
  them to a subagent; that path does not work in this sandbox (no
  LibreOffice, no Poppler). The substitute is: render markitdown,
  quote titles back to the user, ask them to open the deck.

- **Image / chart content.** markitdown does not OCR images. If a user's
  template puts the headline numbers inside an embedded image, you won't
  see them.

## Common gotchas

- Pin to `markitdown[pptx]==0.1.5` (current latest). Earlier 0.0.x
  versions had different CLI semantics.
- Run as `python -m markitdown <path>`, not bare `markitdown` — the
  console script may not be on `PATH` after `uv pip install` in the
  sandbox.
- Output can be long. Don't dump it back through `stdoutPreview` for big
  decks; redirect to `/workspace/output/extracted.md` and `file_read`
  the parts you need.
