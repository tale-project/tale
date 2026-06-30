# Workflow

## Local preview

```bash
bun install                          # first time only
bun run --filter @tale/docs dev      # builds the search index, then starts the Vite dev server
```

Click through the language switcher on every section in every locale. A 404 in any locale means a
missing file or a stale [`docs/nav.json`](../../../docs/nav.json) entry.

## Before every PR

`services/docs` has no `format` script — formatting is repo-wide via the root `oxfmt`
(`bun run format`) and the edit hook. The docs-package scripts are `lint`, `test`, `build`, and
`typecheck`:

```bash
bun run --filter @tale/docs lint      # oxlint --type-aware
bun run --filter @tale/docs test      # structural + prose + terminology + i18n
bun run --filter @tale/docs build     # search index, prerender, llms.txt, sitemap, robots.txt
```

All three must pass. The `test` step (vitest, `include: tests/**`, `lib/**`) covers structural parity
(every nav slug resolves, every page has frontmatter, DE/FR mirrors keep the EN outline), prose checks
(opening has ≥ 2 sentences before any heading or list; closing is not a stub), and the centralized
i18n checks (terminology, voice, style, grammar, ICU parity). The structural rules live in
[`services/docs/tests/`](../../../services/docs/tests/); the i18n framework in
[`packages/ui/src/i18n/tests/`](../../../packages/ui/src/i18n/tests/), run per service via
[`services/docs/lib/i18n/messages.test.ts`](../../../services/docs/lib/i18n/messages.test.ts).

When a test fails, the fix-priority order — and what every check catches — is in
[CHECKS.md](CHECKS.md). For a terminology or formal-pronoun failure, read the
per-locale doctrine at
[`.agents/skills/write-translations/locales/<locale>/AGENTS.md`](../write-translations/locales/) and rewrite to the
locale form.

## Common pitfalls

- **Forgetting [`docs/nav.json`](../../../docs/nav.json).** A file on disk but not in the nav is invisible in the sidebar.
- **Translated anchors that don't match their target.** `/de/foo#some-heading` only works if `docs/de/foo.md` has a heading whose German slug is `some-heading`. Slugs differ per language — `links` does not check anchors.
- **External links cast as internal.** `](/external-site)` is treated as in-site and 404s. External links are fully qualified (`https://…`).
- **Duplicating env-var or API reference content.** The reference pages are authoritative — link to them.
- **Page opens with one sentence and a list.** [`structure-opening.test.ts`](../../../services/docs/tests/structure-opening.test.ts) blocks the PR. Rewrite to 2–4 sentences with the _why_ present.
- **Page closes with `## Next` and a single link.** [`structure-closing.test.ts`](../../../services/docs/tests/structure-closing.test.ts) blocks the PR. Rename the closing section, recap in one paragraph, link with context.
- **DE / FR page leaves a translate-bucket English noun in prose.** Use the native term from [`.agents/skills/write-translations/BUCKETS.md`](../write-translations/BUCKETS.md).
- **DE / FR uses `Sie` / `vous`.** Caught by `pronouns-formal`. Rewrite to `du` / `tu`.
