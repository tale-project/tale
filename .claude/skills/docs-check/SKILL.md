---
name: docs-check
description: How to run and read the structural docs test suite. Read any time docs/ or services/docs/ changes — runs the suite, explains each structural check and the failure it catches, and gives the fix-priority order. Use after renaming/moving/deleting a page, editing docs/nav.json, adding a page in one locale, changing a heading, or before a PR that touches docs. Terminology/voice/loanword checks are NOT here — see the translation skill.
---

# docs-check

The structural test suite is the pre-merge gate for everything under [`docs/`](../../../docs/), run
from [`services/docs/tests/`](../../../services/docs/tests/). It walks the whole `docs/` tree and
asserts three things: the locales mirror each other (**parity**), each page is mechanically sound
(**structure**), and each page reads like a real page, not a stub (**content**). A single failing
assertion rarely tells you which rule broke or where the contract lives — this skill names every
check, what it catches, and the fix. Writing/voice rules live in [`docs`](../docs/SKILL.md);
cross-locale terminology lives in [`translation`](../translation/SKILL.md).

## When this applies

Run it after renaming, moving, or deleting a page; after editing [`docs/nav.json`](../../../docs/nav.json);
after adding a page in one locale; after editing any heading (heading text → slug); after translating
or rewriting a page; and before opening any PR that touches `docs/` or `services/docs/` (CI runs the
same suite via `bunx turbo run test`).

## Run it

```bash
bun run --filter @tale/docs test
```

Runs from any directory in the monorepo. For one file or verbose output:

```bash
cd services/docs && bunx vitest run tests/structure-opening.test.ts
cd services/docs && bunx vitest run --reporter=verbose
```

The same package also exposes `lint` (oxlint), `typecheck` (tsc), and `build`; run those when you
touch the docs _app_, not just content. (There is no `format` script.)

## The checks

Each test scans every page, collects `Finding` records ([`lib/findings.ts`](../../../services/docs/tests/lib/findings.ts)),
and asserts the list is empty — the failure prints each file once with offending lines and a
`[rule]` tag, so the message tells you exactly where and why.

**Parity** — the locales must stay in lockstep (`en/` is the source of truth):

| Check (`*.test.ts`) | Catches → fix                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `walk`              | Harness sanity: walker finds pages, base locales `en`/`de`/`fr` present → if it trips the harness itself is broken (check `lib/paths.ts`, the tree). |
| `navigation`        | A `docs/nav.json` slug with no `.md`/`.mdx` under a locale (renamed page, untranslated page, typo) → create the file or fix/remove the nav entry.    |
| `locale-tree`       | An `en/` page with no DE/FR mirror, or a DE/FR orphan with no `en/` source → create the mirror or delete the orphan.                                 |
| `locale-outline`    | DE/FR drifting from the EN page's heading-depth sequence or fenced-code-block count → restructure the locale page to match EN's outline.             |
| `readme`            | Root `README.md` / `README.<locale>.md` heading outlines diverging, or EN not linking a mirror → mirror the change across all READMEs.               |
| `content-manifest`  | `app/content/frontmatter.json` stale vs on-disk frontmatter → regenerate (`bun run --filter @tale/docs build:search-index`).                         |

**Structure** — each page is mechanically well-formed:

| Check (`*.test.ts`)  | Catches → fix                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `frontmatter`        | A page missing the `---` block or `title`/`description` → add the field (`title` sentence-case; `description` one sentence).                           |
| `filenames`          | A path segment that isn't dash-case lowercase (`API_Reference.md`) — locale segment exempt (`de-CH`) → rename and sweep inbound links.                 |
| `structure-headings` | A body `# H1` (the frontmatter `title` is the H1), depth past H4, or a stub heading name anywhere → demote/split/rename.                               |
| `structure-code`     | A bare ` ``` ` fence with no language → add a tag (`bash`, `typescript`, `json`, `text`, `mermaid`, …).                                                |
| `structure-prose`    | A `!` in prose (outside `!=`/`!important`/image alt), or a status-chatter line opener (`Updated:`, `TODO:`, `Note that…`) → strike it.                 |
| `links`              | A relative/absolute-path page link resolving to no `.md`/`.mdx` (external, anchor-only, and `.ext` asset links are skipped) → fix or write the target. |
| `images`             | An `/images/...` reference with no file under `public/`, empty alt text, or over ~200 KB → fix the path, write a descriptive alt, export WebP.         |

**Content** — each page reads like a real page (the shape contract from [`docs`](../docs/SKILL.md)):

| Check (`*.test.ts`) | Catches → fix                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `structure-opening` | Fewer than 2 sentences of prose before the first heading/list/table/fence (`kind: index` pages exempt) → add a 2–4 sentence opening covering what/who/why. |
| `structure-closing` | A closing section that's a stub name (`Next`, `See also`, `Suite`, …) or a single bare-link line → rename for what it does, add a one-paragraph recap.     |

## Fix order when several fail

Failures cascade top-down — fix in this order:

1. **Navigation parity** (`navigation`) — a 404 slug blocks the build; fix first.
2. **Frontmatter** (`frontmatter`) — two-second fix per page.
3. **Locale parity** (`locale-tree`, then `locale-outline`) — presence before outline; usually the deepest mechanical fix.
4. **Per-page structure** (`filenames`, `links`, `images`, `structure-headings`/`-code`/`-prose`) — mechanical, page-local.
5. **Prose shape** (`structure-opening`, `structure-closing`) — last, because it's the deepest _content_ fix; rewrite to the page-shape contract in [`docs`](../docs/SKILL.md).

## What this does NOT cover

- **Terminology, voice, loanwords, pronouns, German grammar, ICU.** These moved out of this suite into
  the shared i18n test framework at [`packages/ui/src/i18n/tests/`](../../../packages/ui/src/i18n/tests/),
  run per service via `lib/i18n/messages.test.ts` (e.g.
  [`services/docs/lib/i18n/messages.test.ts`](../../../services/docs/lib/i18n/messages.test.ts)). This
  structural suite borrows only the shared stub-heading and status-chatter wordlists from there. For
  the voice rules and how to fix a terminology failure, read [`translation`](../translation/SKILL.md)
  and [`docs`](../docs/SKILL.md).
- **In-page anchor links** (`#section`). `links` checks page targets, not heading anchors. A stripped
  umlaut/accent (`#schema-kompatibilitat` vs the real `#schema-kompatibilität`) or a parenthesised
  heading slug passes silently — read the rendered anchor once and reference it.
- **Locale-prefix-missing links.** A `docs/de/**` link to `/self-hosted/foo` is _resolved_ against the
  page's own locale by `links`, so it passes even when a hand-written cross-locale link should carry
  the prefix; double-check by eye.
- **Inbound links from outside `docs/`.** When you move or rename a page, also grep the monorepo for
  references in app code and README files — the suite only sees the `docs/` tree.

The Playwright smoke spec ([`tests/e2e/specs/`](../../../services/docs/tests/e2e/specs/), run via
`bun run --filter @tale/docs test:e2e`) and the SEO deploy-sim ([`lib/seo/deploy-sim.test.ts`](../../../services/docs/lib/seo/deploy-sim.test.ts))
are separate suites — out of scope here.

## Extending the suite

Add a new check as one `*.test.ts` under [`services/docs/tests/`](../../../services/docs/tests/) using
the shared helpers in [`lib/`](../../../services/docs/tests/lib/): `walk.ts` (`walkDocs`,
`discoverLocales`, `localeOf`, `filesInLocale`, `BASE_LOCALES`), `markdown.ts` (`parseFrontmatter`,
`extractHeadings`, `extractCodeFences`, `extractOpeningProse`, `extractClosingSection`,
`iterProseLines`, masking helpers), `paths.ts` (`CONTENT_ROOT`, `REPO_ROOT`), and `findings.ts`
(`Finding`, `assertNoFindings`). Follow the existing pattern: collect `Finding[]`, then
`assertNoFindings`. Term-shaped rules (UI labels, loanwords) do **not** belong here — add them to the
i18n framework instead.
