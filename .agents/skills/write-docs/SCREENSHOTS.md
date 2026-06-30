# Screenshots

How to capture, store, name, and embed images in the docs. Screenshots earn their place when a sentence cannot carry the layout — a panel with five regions, a chart, a diff view. A walkthrough that reads cleanly does not need one; reach for an image only when the words are doing worse than a picture would. This file is the contract for the ones you do add. The structural test that enforces it is [`services/docs/tests/images.test.ts`](../../../services/docs/tests/images.test.ts).

Every image is a committed asset under `services/docs/public/`, referenced by an absolute `/images/...` path, and carries a full descriptive sentence as alt text. The capture is reproducible — platform UI through Playwright, CLI output through a sanitising script — so a maintainer can regenerate it after a redesign instead of guessing what the old one showed.

## Where images live

Store optimised WebP under `services/docs/public/images/<section>/`, where `<section>` mirrors the docs area the image belongs to (`platform`, `self-hosted`, `cloud`, `develop`, `tutorials`). The docs site serves `public/` at the site root, so a file at `services/docs/public/images/platform/chat-composer.webp` is reachable at `/images/platform/chat-composer.webp`.

Use WebP, not PNG or JPG. WebP compresses screenshots well below the 200KB ceiling the test enforces; a heavier file is almost always an un-optimised PNG and fails the size check. Filenames are dash-case lowercase, the same rule as page slugs, and name the thing shown (`agent-tools-panel.webp`), not the capture order (`screenshot-3.webp`).

## How to embed

Embed with absolute Markdown image syntax and a sentence-case alt that is a complete, descriptive sentence:

```markdown
![The chat composer with the model picker open, showing three available models.](/images/platform/chat-composer.webp)
```

The alt text is not a label — it is the sentence a screen-reader user hears in place of the image, and the fallback a sighted reader sees when the image fails to load. "Chat composer" fails; "The chat composer with the model picker open, showing three available models" passes. The test rejects an empty alt outright; reviewers reject a terse one.

Lead with the image's effect the same way code blocks do: a sentence before or after the image names what the reader is looking at and why it matters. A bare image with no surrounding prose is the same Code Wall anti-pattern, one medium over.

## Capturing platform UI

Capture product screenshots through Playwright, reusing the existing harness at `services/platform/tests/e2e` so the capture runs against a real, seeded instance with the same auth and fixtures the tests use. Drive the app to the exact state, set a fixed viewport so images stay consistent across captures, and screenshot the specific element or region rather than the whole tab — a cropped panel reads better and stays under the size ceiling.

Keep the captured UI in the default locale (`en`) unless the screenshot's point is a string that differs per locale. Most screenshots show layout and interaction, which are identical across locales; a single EN image is correct for all three pages. Capture a `de` or `fr` variant only when the visible text is the subject — a translated label callout, a locale-specific date format — and store it under the same `<section>` path with a locale suffix.

## Capturing CLI output

Capture CLI output through [`tools/cli/scripts/cli-sample-outputs.sh`](../../../tools/cli/scripts/cli-sample-outputs.sh), which runs the selected `tale` commands and pipes them through a sanitiser. Never paste a raw terminal capture: it leaks the real username, hostname, and any email in the output. The sanitiser replaces them with neutral stand-ins — `user@example.com` for emails, `tale` for the hostname, a generic home path for `$HOME` — so a published image never shows a real person.

When a CLI sample is short and text-only, prefer a fenced code block over an image — it is searchable, translatable, and weightless. Reserve a CLI screenshot for output where colour or alignment is the point (a status table, a coloured diff), and even then run it through the sanitiser first.

## Where this fits

Screenshots are committed assets with the same bar as prose: reproducible capture, descriptive alt text, optimised size, and a path that mirrors the docs taxonomy. The [`images.test.ts`](../../../services/docs/tests/images.test.ts) check is the floor — it catches a missing file, a blank alt, or an oversized asset — and these conventions are the rest, the part a test cannot judge. When you add the first screenshot to a page, you also add the asset under `public/images/<section>/` in the same PR; an image reference with no committed file fails the suite.

The broader docs contract lives in [SKILL.md](SKILL.md); the per-locale rules for translated alt text and callouts live in the companion [`write-translations`](../write-translations/SKILL.md) skill. Read those for voice and locale parity; read this file before you reach for a capture tool.
