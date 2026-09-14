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
- Redirects: [`docs/redirects.json`](redirects.json) — old slug → new slug for every moved or
  merged page; served as 301s and prerendered as meta-refresh stubs.
- The site: `services/docs/` (Vite + React + TanStack Router, prerendered static HTML). Its
  chrome follows the **platform app** design language — a `SubPanel` navigation rail, one sticky
  `h-13` header strip carrying the breadcrumb trail and the page actions, the article column, and
  the "On this page" outline (a rail from `xl`, a disclosure below it). Component map:
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
the relevant service’s `messages/<locale>.yml` merged over shared package catalogs character-for-character,
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

`noindex: true` (legal/drafts), `kind: index` (locale-root landing pages, exempt from the opening
rule), `noCurrencyCheck: true`, `noEmDashCheck: true`, `i18nLintExclude: ["check-id"]` — sparingly,
with a comment.

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
- EN captures only; alt text and captions translate per locale.

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

## Pitfalls

- A file on disk but missing from `nav.json` is invisible in the sidebar.
- Translated heading anchors: `/de/foo#some-heading` only works if the German heading slugs to
  `some-heading`, or the heading has that explicit ID. The section-link check verifies these targets.
- External links cast as internal (`](/external-site)`) 404 — fully qualify them.
- Env-var and API reference content is authoritative in one place — link, don't duplicate.
- Moving or renaming a page: add the `redirects.json` entry, sweep inbound links repo-wide (the
  suite only sees `docs/`), and update `nav.json` + all three locales in the same change.
