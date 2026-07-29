# Tale docs — the repo contract

The repo facts for anyone writing under `docs/`. The method — journey-first pages, show-then-tell
screenshots, verified code, component discipline — is the [`write-docs`](../.agents/skills/write-docs/SKILL.md)
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
- The site: `services/docs/` (Vite + React + TanStack Router, prerendered static HTML).

## Directory → tab → audience

| Directory      | Tab         | Audience                                                                                                      |
| -------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `get-started/` | Start       | Everyone's first 15 minutes, split by role — the journey layer.                                               |
| `cloud/`       | Cloud       | Managed-SaaS readers — onboarding, billing, data residency, trust, compliance.                                |
| `self-hosted/` | Self-hosted | Operators running Tale on their own infrastructure.                                                           |
| `platform/`    | Platform    | Product feature reference. Identical for Cloud and Self-hosted. The single source of truth for every feature. |
| `tutorials/`   | Tutorials   | Role-indexed end-to-end journeys on a running instance.                                                       |
| `develop/`     | Develop     | API consumers, webhook integrators, SDK users, source contributors.                                           |
| `legal/`       | (footer)    | Privacy policy, terms of service, DPA. `noindex: true`; exempt from the journey treatment.                    |

**`platform/` vs `self-hosted/configuration/`.** `platform/` is the UI — anything a user does
inside the running app (`Settings > …`). `self-hosted/configuration/` is server-side — config
files (`TALE_CONFIG_DIR/**`), env vars, CLI, Docker. When a feature has both, `platform/` describes
only the UI path and links to the self-hosted reference. Never paste a JSON config snippet or an
env-var table into a `platform/` page — it contradicts the Cloud reader's reality.

## Locales ship together

Every user-visible change updates `en`, `de`, and `fr` in the same PR — `locale-tree` and
`locale-outline` fail otherwise. DE and FR are authored natively per
[`write-translations`](../.agents/skills/write-translations/SKILL.md) (one narrator per language,
`du`/`tu`, loanword buckets), never rendered word-for-word. UI labels match
`services/platform/messages/<locale>.yml` character-for-character. The voice strike lists live in
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

## Pattern pages

Read the current best-of-type before writing your first page of that type: journey —
`en/tutorials/editor/first-agent-end-to-end.md`; feature page — `en/platform/chat/basics.md`;
concept — `en/platform/agents/concepts.md`; reference — `en/self-hosted/configuration/providers.md`;
overview — `en/platform/admin/overview.md`; glossary —
`en/self-hosted/configuration/environment-reference.md`.

## Pitfalls

- A file on disk but missing from `nav.json` is invisible in the sidebar.
- Translated heading anchors: `/de/foo#some-heading` only works if the German heading slugs to
  `some-heading` — the link checker does not verify anchors.
- External links cast as internal (`](/external-site)`) 404 — fully qualify them.
- Env-var and API reference content is authoritative in one place — link, don't duplicate.
- Moving or renaming a page: add the `redirects.json` entry, sweep inbound links repo-wide (the
  suite only sees `docs/`), and update `nav.json` + all three locales in the same change.
