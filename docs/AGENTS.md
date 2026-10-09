# Tale docs — the repo contract

The repo facts for anyone writing under `docs/`. The method — reader tasks, observed behavior,
useful images, native translations, and verified examples — is the [`write-docs`](../.agents/skills/write-docs/SKILL.md)
skill; this file is what its "discover the repo's contract" step discovers. The per-check test
reference lives in [`services/docs/tests/AGENTS.md`](../services/docs/tests/AGENTS.md).

## The tree

- Content: `docs/{en,de,fr}/` — three full mirrors; `en` is the source of truth. A sparse `de-CH`
  regional tree is supported (override only pages whose wording genuinely differs from `de`).
- Navigation: [`docs/nav.json`](nav.json) — sidebar order is array order; `label` values are i18n
  keys under `nav.groups.*` resolved from `services/docs/messages/{en,de,fr,de-CH}.yml`. A page on
  disk but not in the nav is invisible; a nav slug with no file fails the suite.
- Redirects: [`docs/redirects.json`](redirects.json) — old slug → new slug for every moved,
  merged or deleted page; served as 301s and prerendered as meta-refresh stubs. A page that moved
  to tale.dev (the legal texts) maps to its `https://tale.dev/…` URL and keeps the reader's locale
  there. A section folder with no page of its own (`/platform/automations`) redirects to the first
  page under it in `nav.json` order — derived, never listed here, so reordering `nav.json` moves
  that target; a `redirects.json` entry for the folder wins.
- Published addresses: [`docs/published.json`](published.json) — every slug the site has ever
  served, append-only (the docs build records new pages; never delete a line). Each must keep
  answering in every locale, as a page or through `redirects.json`: a page that goes away without
  a redirect fails `tests/published.test.ts`. The retired `de-CH`, `de-AT` and `fr-CH` trees and
  guessed addresses (a title turned into a slug, a translated folder, a sidebar group's label such
  as `/de/verwaltung`) are answered by the server's near-miss resolver (`lib/near-miss.ts`), not by
  entries here.
- The site: `services/docs/` (Vite + React + TanStack Router, prerendered static HTML). The root
  and locale roots open the first guide in `docs/nav.json`, with the same shared documentation
  frame as every deep guide. There is no separate locale-root `index.md`; legacy root Markdown
  aliases redirect to the first guide's export. Guide pages keep the **platform app** design
  language — a `SubPanel` navigation rail, one sticky `h-13` header strip carrying the breadcrumb
  trail and the page actions, the article column, and the "On this page" outline (a rail from
  `xl`, a disclosure below it). That chrome is the shared `@tale/ui/docs/*` frame the design-system
  guide renders too; change it in `packages/ui`, never in a site. Component map:
  [`services/docs/README.md`](../services/docs/README.md) → _The page layout_.

This contract covers Tale’s product documentation. The separate English design-system guide
at `services/ui-docs/content/` follows its own [authoring contract](../services/ui-docs/content/README.md)
and adds live `<Demo>` examples; that tag is not part of this site’s Markdown registry.

## Directory → tab → audience

| Directory      | Tab         | Audience                                                                                                      |
| -------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `get-started/` | Start       | First success and orientation, with routes matched to the reader's role.                                               |
| `cloud/`       | Cloud       | Managed-SaaS readers — onboarding, billing, data residency, trust, compliance.                                |
| `self-hosted/` | Self-hosted | Operators running Tale on their own infrastructure.                                                           |
| `platform/`    | Platform    | Everyday product tasks, feature guides, and explanations shared by Cloud and Self-hosted. |
| `tutorials/`   | Tutorials   | Guided end-to-end tasks on a running instance, with explicit prerequisites and checkpoints.                                                       |
| `develop/`     | Develop     | API consumers, webhook integrators, SDK users, source contributors.                                           |
| `legal/`       | (footer)    | Privacy policy, terms of service, DPA. `noindex: true`; exempt from the journey treatment.                    |

**`platform/` vs `self-hosted/configuration/`.** `platform/` is the UI — anything a user does
inside the running app (`Settings > …`). `self-hosted/configuration/` is server-side — config
files (`TALE_CONFIG_DIR/**`), env vars, CLI, Docker. When a feature has both, `platform/` describes
only the UI path and links to the self-hosted reference. Never paste a JSON config snippet or an
env-var table into a `platform/` page — it contradicts the Cloud reader's reality.

## Locales ship together

Every user-visible change updates `en`, `de`, and `fr` in the same PR. `locale-tree`,
`locale-outline`, and `locale-components` check presence and structure; reviewers verify equivalent
meaning and completeness. DE and FR are authored natively per
[`write-translations`](../.agents/skills/write-translations/SKILL.md) (one narrator per language,
`du`/`tu`, loanword buckets), never rendered word-for-word. UI labels match
the relevant service’s `messages/<locale>.yml` (the platform’s `messages/<locale>/<topic>.yml`) merged over shared package catalogs character-for-character,
including locale fallback. Preserve factual currencies, values, jurisdictions, permissions, and
limits while translating. A locale changes the language, not the contract. The voice strike lists live in
`packages/ui/src/i18n/tests/locales/<locale>/voice.ts`. Internal links in non-`en` pages carry the
locale prefix (`/de/...`, `/fr/...`) — including `href` attributes on components.

## The component registry

The renderer is `react-markdown` + `rehype-raw`; the authored vocabulary lives in
[`packages/ui/src/markdown/components/registry.tsx`](../packages/ui/src/markdown/components/registry.tsx):
`<Note> <Tip> <Info> <Warning> <Check> <Callout tone>`, `<Card title icon href>` /
`<CardGroup cols>`, `<Steps>`/`<Step title>`, `<Tabs>`/`<Tab title>`, `<CodeGroup>` (tab labels
from the fence meta string: ` ```bash cURL `), `<Accordion>`/`<AccordionGroup>`,
`<Frame caption>`, and ` ```mermaid ` fences. GFM alerts (`> [!NOTE]`) render as callouts. Icons
on `<Card>` are kebab-case Lucide names. **Blank lines between every component tag and its
content** — the markdown inside won't parse otherwise. Images only as
`![sentence alt](/images/...)` markdown syntax inside `<Frame>` — a raw `<img>` escapes the image
checks.

## Frontmatter opt-outs (Tale-specific)

`noindex: true` (legal/drafts), `kind: index` (section index pages whose cards provide the opening
orientation), `noCurrencyCheck: true`, `noEmDashCheck: true`, `i18nLintExclude: ["check-id"]` —
sparingly, with a comment.

## Screenshots — the Tale pipeline

- Assets: WebP under `services/docs/public/images/<section>/` (section mirrors the docs area),
  referenced `/images/<section>/<name>.webp`, dash-case content-named, **< 200 KB**, full-sentence
  alt. Enforced by `services/docs/tests/images.test.ts`.
- Capture: manifest-driven — every image is declared in
  `services/platform/tests/docs-screenshots/manifest.ts` and captured with
  `bun run docs:screenshots [-- --only <shot>]` against the seeded local
  stack (the runbook is `services/platform/tests/docs-screenshots/README.md`). No hand-captured
  image ships. When a PR changes a route, grep the manifest for it and regenerate in the same PR.
- CLI output: `tools/cli/scripts/cli-sample-outputs.sh` (sanitized) — but prefer fenced code.
- Docs share EN captures by default; alt text and captions translate per locale. The same
  pipeline supports `--locales en,de,fr` for native UI captures used by marketing or a
  locale-specific layout example. DE/FR files live under `<section>/<locale>/` and the
  generated image manifest records each capture's locale.

## Commands

```bash
bun run --filter @tale/docs dev     # preview on :3002 (builds the search index first)
bun run --filter @tale/docs lint    # oxlint --type-aware
bun run --filter @tale/docs test    # the structural suite — see services/docs/tests/AGENTS.md
bun run --filter @tale/docs build   # search index, prerender, llms.txt, sitemap
bun run format                      # repo-wide oxfmt — services/docs has no format script
```

After changing any frontmatter, regenerate the manifest the suite checks:
`bun run --filter @tale/docs build:search-index`.

## Content decisions

Give each page a primary job: first-time tutorial, focused how-to, explanation, reference,
troubleshooting, or navigation. Match the assumed knowledge to the task, not a vague “all users”
audience. Readers should be able to enter from search and identify the prerequisites and outcome.

Use a concise useful opening; one sentence can be sufficient. Add detail where it answers a real
question: access requirements, inputs, choice of setting, visibility, persistence, result, limits,
or recovery. A field inventory alone does not explain how to complete a task. A tutorial should
provide a verified path and observable checkpoints without requiring optional reference reading.

Images clarify unfamiliar locations, states, or results. They are not required at every step;
written instructions must remain complete without them. Tips need a concrete optional benefit.
Keep necessary warnings and troubleshooting visible. End when the page has answered the need;
a recap and a named closing are optional. Useful next links do not require a padding paragraph.

Existing pages are evidence to inspect, not “perfect” templates to reproduce. Find the canonical
owner of a claim, verify it, and link it rather than spreading copies of limits or settings.
Published URL changes require redirects and a repo-wide inbound-link sweep.

## Product evidence and review

Drive the running platform's described tasks using seeded disposable data. Record the starting
role/state, actions, result, and relevant failures in the task note outside the clone. Read source
and tests for hidden behavior, but do not substitute them for using a UI. Verify code examples in
the documented environment and label any excerpts or normalized output.

An observed mismatch is a docs or product finding. Fix an authorized defect with a regression
check and rerun the flow; otherwise record it and document the verified limitation. Do not invent
unobserved waiting times or platform promises. Keep existing videos unchanged when videos are
outside the task's scope.

Review rendered pages at desktop and narrow widths. Check heading hierarchy, keyboard navigation,
component rendering, image legibility, tables, and code. Read each locale independently for flow,
then compare factual meaning. Run checks and inspect advisory locale findings; a green structural
suite does not establish fluent or accurate prose.

## Retire, rename or merge a page

A docs address that was ever published keeps answering: bookmarks, search results, links in older
releases and language models all still ask for it.

1. Choose the page that replaces it: the one that answers the same reader task. Only a page with
   no successor falls back to its section.
2. Add `"<old slug>": "<new slug>"` to [`docs/redirects.json`](redirects.json). One locale-less
   entry covers `/de` and `/fr`, and a page that moved to tale.dev maps to its `https://tale.dev/…`
   URL.
3. Keep the old slug's line in [`docs/published.json`](published.json). Never delete a line.
4. Move or delete the file in all three locales, with `git mv` for a rename, and update `nav.json`.
5. Regenerate with `bun run --filter @tale/docs build:search-index` (the manifest and the ledger).
6. Run `bun run lint:links`, then point every link it reports at the new page. That covers docs
   pages, READMEs, app help and the marketing site.
7. Renaming only a heading that others link to: keep its old id with `{#old-id}`.

The gates hold you to it. `bun run lint:links` compares the change with its base commit. It refuses
a deleted or renamed page whose old address now answers 404 (`retired-page-404`), naming the
redirect to add, and a removed ledger line (`published-line-removed`). `tests/published.test.ts`
refuses any published slug that stops answering in any locale.

## Pitfalls

- A file on disk but missing from `nav.json` is invisible in the sidebar.
- Translated heading anchors: `/de/foo#some-heading` only works if the German heading slugs to
  `some-heading`, or the heading has that explicit ID. The link suite (`tests/links.test.ts`)
  verifies every fragment against the ids the target page renders.
- External links cast as internal (`](/external-site)`) 404 — fully qualify them.
- Env-var and API reference content is authoritative in one place — link, don't duplicate.
- Moving, renaming or deleting a page without a redirect: follow
  [Retire, rename or merge a page](#retire-rename-or-merge-a-page); the gates refuse anything less.
- Reordering `nav.json` can change where a section folder URL (`/platform/<section>`) redirects:
  it lands on the first page listed under that folder.
