---
name: check-broken-links
description: Run after editing anything under docs/ to catch broken internal links and anchor mismatches before committing. Use whenever markdown pages, headings, or docs.json navigation change.
---

# Check broken doc links

After changing any file under [`docs/`](../../docs/), run the Mintlify broken-link check. The same check gates CI via `bunx turbo run lint` — running it locally saves a round-trip.

## Usage

```bash
bun run --filter @tale/docs lint:broken-links
```

This runs `mintlify broken-links --check-anchors` against [`docs/`](../../docs/) and every locale mirror (`en`, `de`, `fr`). Fix every reported link before declaring a docs change done.

## When to run

- After renaming, moving, or deleting a page.
- After editing any heading (heading text → slug; anchor links break silently).
- After editing [`docs/docs.json`](../../docs/docs.json).
- Before opening a PR that touches `docs/`.

## Common failure modes and fixes

- **Anchor with stripped umlaut or accent.** `mintlify` slugger preserves unicode, so a link `#schema-kompatibilitat-und-rollback` will not match a heading `## Schema-Kompatibilität und Rollback` — the correct anchor is `#schema-kompatibilität-und-rollback`. Fix the link, not the heading.
- **Heading with parentheses or dots.** Slug generation for `## Upgrading from pre-split-convex (pre-v0.2.34)` is not obvious. Lock it in with an explicit `{#explicit-slug}` suffix on the heading, then reference that slug from links.
- **Page moved without updating callers.** `grep -r` for the old path across all three locale trees and update.
- **Link in a non-English file missing its locale prefix.** A link in `docs/de/**` to `/self-hosted/foo` 404s — it must be `/de/self-hosted/foo`.

## Limits of this check

`mintlify broken-links --check-anchors` catches internal links between docs pages and anchors within them. It does **not** check:

- External URLs (add `--check-external` when needed; slow).
- Links from outside `docs/` (e.g. app code, README). When moving a doc page, also grep the monorepo for inbound links.
