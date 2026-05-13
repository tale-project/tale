---
name: check-broken-links
description: Validates docs navigation, frontmatter, translation parity, and terminology before committing changes under `docs/`.
---

# Check docs integrity

After changing any file under [`docs/`](../../docs/) or [`docs/nav.json`](../../docs/nav.json), run the docs test suite. The same checks gate CI via `bunx turbo run test` — running them locally saves a round-trip.

## Usage

```bash
bun run --filter @tale/docs test
```

This runs the Vitest suite under [`services/docs/tests/`](../../services/docs/tests/):

- **navigation-parity** — every slug in [`docs/nav.json`](../../docs/nav.json) resolves to a real `.md`/`.mdx` file in `en`, `de`, and `fr`.
- **frontmatter** — every page has a `title` and `description` in its YAML frontmatter.
- **locale-parity** — translated mirrors keep the same heading outline and code-block count as their English source.
- **readme-parity** — `README.md`, `README.de.md`, `README.fr.md` stay in structural sync.
- **terminology** — translated pages use the informal pronoun and quote UI labels from [`.agents/terminology/GLOSSARY.json`](../terminology/GLOSSARY.json).

Fix every failure before declaring a docs change done.

## When to run

- After renaming, moving, or deleting a page.
- After editing any heading (heading text → slug; anchor links break silently).
- After editing [`docs/nav.json`](../../docs/nav.json).
- Before opening a PR that touches `docs/` or `services/docs/`.

## What this check does NOT cover

The test suite catches structural and translation issues but does **not** crawl every internal `[link](/path)` reference in page body text — only navigation slugs and translation parity. When you move a page, also grep the monorepo for inbound links from outside the nav (other doc pages, app code, `README.md`).

Pitfalls the suite cannot catch:

- **Anchor with stripped umlaut or accent.** Slug generation preserves unicode, so a link `#schema-kompatibilitat-und-rollback` will not match a heading `## Schema-Kompatibilität und Rollback` — the correct anchor is `#schema-kompatibilität-und-rollback`. Fix the link, not the heading.
- **Heading with parentheses or dots.** Slug generation for headings like `## Foo (bar)` or `## Step 1.2 — bootstrap` is not obvious. Read the heading anchor from the rendered page once, then reference that slug from links.
- **Link in a non-English file missing its locale prefix.** A link in `docs/de/**` to `/self-hosted/foo` 404s — it must be `/de/self-hosted/foo`.
