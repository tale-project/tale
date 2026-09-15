# Useful, reproducible screenshots

Add an image when it helps readers locate a control, recognize a state, compare choices, or
understand a result. An unfamiliar picker may need a close-up; a routine Save action may need
only a sentence. Neither a screenshot at every step nor a hero image on every page is required.

Write down the question the image answers before capturing it. Place it near the instruction or
explanation it supports. The surrounding text must still let readers complete the task without
seeing the image. Text, code, and terminal output normally belong in selectable fenced blocks.

## Capture through the repository pipeline

Every shipped screenshot must be declared in the capture manifest and reproducible with the
repository's capture command. The manifest owns the route, interaction, seeded state, viewport,
and crop. Read the runbook named by `docs/AGENTS.md`; do not ship manual browser screenshots,
retouched UI, or images generated to resemble the product.

Use synthetic but plausible projects, people, documents, and dates. Never use customer data or
real credentials. Improve fixtures when the scene is empty or implausible, then capture it again.
Keep transient data deterministic through the pipeline. Do not conceal a broken state by painting
pixels over it.

When the UI changes, search the manifest for the affected route or surface. Regenerate the
relevant assets and inspect them. A successful capture command proves the file exists, not that
the image communicates the intended state.

## Frame and crop

Use the smallest region that explains the point while keeping enough orientation to recognize
where it is. A panel title or active navigation item often supplies that context. Keep a consistent
viewport and device-pixel ratio. Capture a settled state without browser chrome, pointer, loading
placeholders, clipped menus, or partially finished animations unless that state is the subject.

Follow the repository's image format and byte/dimension budgets. Check legibility at actual docs
content width and on a narrow screen. Reconsider a full-window image before reducing it until all
text is unreadable. Use focused views for materially different states, not a filmstrip of clicks.

## Locale and accessibility

Tale normally shares English capture pixels across locales. Translate the instructions, alt text,
and captions; use the exact localized UI labels in the prose. If the difference would confuse a
reader, explain that the image shows the English interface. A locale-specific capture is warranted
when translated layout or locale formatting is itself the subject; declare it in the pipeline.

Embed Markdown image syntax inside a Frame. Supply a concise descriptive sentence as alt text
under Tale's image checks, focusing on the state that matters. The caption adds why it matters
or what to inspect. Do not encode essential instructions only in arrows, color, or image text.
An instructional screenshot needs useful alternative text; decorative images rarely belong in
task documentation.

## Review evidence

Before handing off an asset, confirm the manifest entry, successful regeneration, truthful state,
readable crop, safe fixture data, translated alt/caption, and rendered placement. Include any
capture limitations in the task note. Retain video assets unchanged when the user excludes videos
from the assignment.
