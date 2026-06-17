# Workflow

## Local preview

```bash
bun install                          # first time only
bun run --filter @tale/docs dev      # builds search index + llms artifacts, then starts the Vite dev server
```

Click through the language switcher on every section on every locale. A 404 in any locale means a missing file or a stale [`docs/nav.json`](../../../docs/nav.json) entry.

## Before every PR

`services/docs` has no `format` script — formatting is repo-wide via the root `oxfmt` (`bun run format`) and the edit hook. The docs-package scripts are `lint`, `test`, `build`, and `typecheck`:

```bash
bun run --filter @tale/docs lint      # oxlint --type-aware
bun run --filter @tale/docs test      # structural + prose + terminology + i18n
bun run --filter @tale/docs build     # search index, prerender, llms.txt, sitemap, robots.txt
```

All three must pass. The `test` step covers structural parity (every nav slug resolves, every page has frontmatter, DE/FR mirrors keep the EN outline), prose checks (opening has ≥ 2 sentences before any heading or list; closing is not a stub), and the centralized i18n checks (terminology, voice, style, grammar, ICU parity). The framework lives in [`packages/ui/src/i18n/tests/`](../../../packages/ui/src/i18n/tests/); inspect [`services/docs/tests/`](../../../services/docs/tests/) for docs-specific structural rules.

## What to fix first when a test fails

1. **Navigation parity** — every slug in `nav.json` resolves to a file in `en/`, `de/`, `fr/`. Blocks everything else; fix first.
2. **Frontmatter** — every page has `title` and `description`. Two-second fix per page.
3. **Locale parity** — DE / FR mirror the EN outline. If you restructured the EN page, mirror the restructure in DE + FR before committing.
4. **Terminology / formal pronouns / loanwords** — language-specific. Read the per-locale doctrine at `.claude/skills/translation/locales/<locale>/AGENTS.md` and rewrite to the locale form.
5. **Opening / closing paragraphs** — usually the deepest fix. Rewrite to the page-shape contract in [SKILL.md](SKILL.md).

## Common pitfalls

- **Forgetting [`docs/nav.json`](../../../docs/nav.json).** A file on disk but not in the nav is invisible in the sidebar.
- **Translated anchors that don't match their target.** `/de/foo#some-heading` only works if `docs/de/foo.md` has a heading whose German slug is `some-heading`. Slugs differ per language.
- **External links cast as internal.** `](/external-site)` is treated as in-site and 404s. External links are fully qualified.
- **Committing without formatting.** Run the repo-wide `oxfmt` (`bun run format`, or let the edit hook do it) first so reviewers don't wade through alignment or whitespace noise.
- **Duplicating env var or API reference content.** The reference pages are authoritative — link to them.
- **Page opens with one sentence and a list.** [`structure-opening.test.ts`](../../../services/docs/tests/structure-opening.test.ts) blocks the PR. Rewrite to 2–4 sentences with the _why_ present.
- **Page closes with `## Next` and a single link.** [`structure-closing.test.ts`](../../../services/docs/tests/structure-closing.test.ts) blocks the PR. Rename the closing section, recap in one paragraph, link with context.
- **DE / FR page leaves a translate-bucket English noun in prose.** Caught by the new centralized framework. Use the native term from [`.claude/skills/translation/BUCKETS.md`](../translation/BUCKETS.md).
- **DE / FR uses `Sie` / `vous`.** Caught by `pronouns-formal`. Rewrite to `du` / `tu`.
