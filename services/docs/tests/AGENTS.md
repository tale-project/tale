# Docs structural test suite — checks and fixes

The structural test suite is the pre-merge gate for everything under [`docs/`](../../../docs/),
run from this directory. It walks the whole tree and asserts three things: the locales mirror each
other (**parity**), each page is mechanically sound (**structure**), and pages have an introduction and no empty final section (**content presence**). Editorial
quality and factual accuracy require a separate review. A single failing assertion rarely says which rule broke —
this file names every check, what it catches, and the fix. The writing method lives in the
[`write-docs`](../../../.agents/skills/write-docs/SKILL.md) skill; the Tale repo facts in
[`docs/AGENTS.md`](../../../docs/AGENTS.md); cross-locale terminology in
[`write-translations`](../../../.agents/skills/write-translations/SKILL.md).

## When this applies

Run it after renaming, moving, or deleting a page; after editing
[`docs/nav.json`](../../../docs/nav.json); after adding a page in one locale; after editing any
heading (heading text → slug); after translating or rewriting a page; and before opening any PR
that touches `docs/` or `services/docs/` (CI runs the same suite via `bunx turbo run test`).

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
touch the docs _app_, not just content. (There is no `format` script — use the repo-wide
`bun run format`.)

## The checks

Each test scans every page, collects `Finding` records ([`lib/findings.ts`](lib/findings.ts)),
and asserts the list is empty — the failure prints each file once with offending lines and a
`[rule]` tag.

**Parity** — the locales must stay in lockstep (`en/` is the source of truth):

| Check (`*.test.ts`)  | Catches → fix                                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `walk`               | Harness sanity: walker finds pages, base locales `en`/`de`/`fr` present → if it trips the harness itself is broken (check `lib/paths.ts`, the tree).            |
| `navigation`         | A `docs/nav.json` slug with no `.md`/`.mdx` under a locale (renamed page, untranslated page, typo) → create the file or fix/remove the nav entry.               |
| `locale-tree`        | An `en/` page with no DE/FR mirror, or a DE/FR orphan with no `en/` source → create the mirror or delete the orphan.                                            |
| `locale-outline`     | DE/FR drifting from the EN page's heading-depth sequence or fenced-code-block count → restructure the locale page to match EN's outline.                        |
| `locale-translation` | A DE/FR page whose opening paragraph is byte-identical to the EN source's (an untranslated English mirror) → author the page natively per `write-translations`. |
| `locale-components`  | DE/FR drifting from the EN page's ordered sequence of component opening tags (a dropped `<Warning>`, a reordered `<Step>`) → match EN's components.             |
| `readme`             | Root `README.md` / `README.<locale>.md` heading outlines diverging, or EN not linking a mirror → mirror the change across all READMEs.                          |
| `content-manifest`   | `app/content/frontmatter.json` stale vs on-disk frontmatter → regenerate (`bun run --filter @tale/docs build:search-index`).                                    |

**Structure** — each page is mechanically well-formed:

| Check (`*.test.ts`)  | Catches → fix                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontmatter`        | A page missing the `---` block or `title`/`description` → add the field (`title` sentence-case; `description` one sentence).                                                                                                                                                                                                                                            |
| `filenames`          | A path segment that isn't dash-case lowercase (`API_Reference.md`) — locale segment exempt (`de-CH`) → rename and sweep inbound links.                                                                                                                                                                                                                                  |
| `structure-headings` | A body `# H1` (the frontmatter `title` is the H1) or depth past H4 → demote/split. Heading wording is reviewed for usefulness, not checked against a blacklist.                                                                                                                                                                                                                                                |
| `structure-steps` | Bare headings, paragraphs, or other content directly inside `<Steps>`, or an untitled `<Step>` → wrap each action in `<Step title="…">` and keep its explanation and images inside that wrapper. The check uses the actual Markdown renderer. |
| `structure-code`     | A bare ` ``` ` fence with no language → add a tag (`bash`, `typescript`, `json`, `text`, `mermaid`, …).                                                                                                                                                                                                                                                                 |
| `structure-prose`    | A `!` in prose (outside `!=`/`!important`/image alt), or a status-chatter line opener (`Updated:`, `TODO:`, `Note that…`) → strike it.                                                                                                                                                                                                                                  |
| `links`              | A relative/absolute-path page link resolving to no `.md`/`.mdx` (external, anchor-only, and `.ext` asset links are skipped) → fix or write the target; German and French links must retain their locale prefix.                                                                                                                                                                                                                  |
| `anchors` | An internal fragment without a matching rendered heading or explicit ID → use the renderer’s slug, or retain the old ID when renaming a section. |
| `images`             | An `/images/...` reference with no file under `public/`, empty alt text, over ~200 KB, or a raw `<img>` tag (bypasses these checks) → fix the path, write a descriptive alt, export WebP, use markdown image syntax inside `<Frame>`.                                                                                                                                   |
| `image-manifest`     | A `.webp` on disk that no page references, one missing from `public/images/manifest.json` (hand-captured — regenerate via `bun run docs:screenshots`), a manifest entry with no file, or a width over 2880/odd (the DPR-2 contract, parsed by `lib/webp-size.ts`).                                                                                                      |
| `videos`             | A video asset outside `public/videos/manifest.json` (hand-recorded — produce via `bun run docs:videos`), a stale entry, a name off `<episode>.<locale>.(mp4\|vtt\|webp)`, an episode missing a base locale, a `<Video>` whose src/poster/captions is absent or crosses locales, an orphaned asset, an mp4 over 40 MB / poster over 250 KB, or a malformed WebVTT track. |
| `redirects`          | A `docs/redirects.json` target that resolves to no page, a source that still exists as a page, a chain (target is itself a source), or a malformed slug → fix the entry.                                                                                                                                                                                                |

**Content presence** — small mechanical checks, not prose templates:

| Check (`*.test.ts`) | Catches → fix                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `structure-opening` | No introductory prose before the first structural element (`kind: index` pages exempt) → add useful orientation. One sentence can suffice; comments and images do not count as prose. |
| `structure-closing` | A final heading with no content → complete or remove the empty section. A result, descriptive link, table, or code example is a valid ending; no recap is required.     |

## Fix order when several fail

Failures cascade top-down — fix in this order:

1. **Navigation parity** (`navigation`) — a 404 slug blocks the build; fix first.
2. **Frontmatter** (`frontmatter`) — two-second fix per page.
3. **Locale parity** (`locale-tree`, then `locale-outline`) — presence before outline.
4. **Per-page structure** (`filenames`, `links`, `images`, `structure-headings`/`-code`/`-prose`).
5. **Content presence** (`structure-opening`, `structure-closing`), then editorial review of
   the reader's task, clarity, factual accuracy, and native locale flow.

## What this does NOT cover

- **Terminology, voice, loanwords, pronouns, German grammar, ICU.** These live in the shared i18n
  framework at [`packages/ui/src/i18n/tests/`](../../../packages/ui/src/i18n/tests/), run per
  service via [`../lib/i18n/messages.test.ts`](../lib/i18n/messages.test.ts). This structural
  suite borrows the shared status-chatter wordlist. The old stub-heading blacklist is no longer
  used: the heading alone cannot tell whether a next-step section is useful.
- **Inbound links from outside `docs/`.** When you move or rename a page, also grep the monorepo
  for references in app code and README files — and add the
  [`docs/redirects.json`](../../../docs/redirects.json) entry.

The Playwright smoke spec ([`e2e/`](e2e/), run via `bun run --filter @tale/docs test:e2e`) and the
SEO deploy-sim ([`../lib/seo/deploy-sim.test.ts`](../lib/seo/deploy-sim.test.ts)) are separate
suites — out of scope here.

## Extending the suite

Automate objective defects: broken links, missing translations, malformed markup, empty content,
unreproducible assets. Do not enforce sentence counts, word budgets, required recap language,
or images per step. These measures encourage filler without proving usefulness. Keep regression
fixtures for concise valid content and structural false positives, including code and HTML comments.

Add a new check as one `*.test.ts` in this directory using the shared helpers in [`lib/`](lib/):
`walk.ts` (`walkDocs`, `discoverLocales`, `filesInLocale`, `BASE_LOCALES`),
`markdown.ts` (`parseFrontmatter`, `extractHeadings`, `extractCodeFences`, `extractOpeningProse`,
`extractClosingSection`, `iterProseLines`, `COMPONENT_TAGS` + component-tag helpers, masking
helpers), `webp-size.ts` (WebP header dimensions, no deps), `paths.ts` (`CONTENT_ROOT`,
`REPO_ROOT`), and `findings.ts` (`Finding`, `assertNoFindings`). Follow the existing pattern:
collect `Finding[]`, then `assertNoFindings`. Term-shaped rules (UI labels, loanwords) do **not**
belong here — add them to the i18n framework instead.
