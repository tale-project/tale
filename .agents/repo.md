# Tale — the repo contract

Repo-specific rules for the Tale monorepo. The shared contract in [`AGENTS.md`](../AGENTS.md)
applies first; this file adds what is true only here.

Tale is a monorepo on Bun workspaces; every workspace script runs through
`bun run --filter @tale/<workspace> <script>`.

## Layout

- `services/` — deployable units: `platform` (the flagship app: Vite + React 19 + TanStack Router +
  the Postgres backend), `web` (marketing site), `docs` (docs site), plus `db`, `proxy`, and the
  `sandbox*` family.
- `packages/` — `ui` (the design system), `shared` (schemas + pg), `e2e` (Playwright config
  factory).
- `tools/` — `cli` (`@tale/cli`), `plop` (generators), `opengrep` (SAST gate).
- `configs/platform/` — the builtin, org-independent config catalog (`system/` read-only,
  `custom/` seeded per org). This is NOT per-customer content; that lives in the separate
  `tale-project/configs` repository.
- `design/` — the design system contract (`docs/` + `sources/`). **UI in scope? Learn
  [`design/`](../design/) and `@tale/ui` first, then build to it.**

## Repo-specific boundaries

- **Never run `bun run setup:clean`** (wipes `services/platform/.convex/local/`) unless the user
  explicitly asked to delete their local Convex dev data — automatic dev maintenance handles module
  bloat; the clean script requires typing `delete local convex` on purpose.
- **Org configuration is files, not tables** — per-org config is JSON/YAML under
  `$TALE_CONFIG_DIR/<org>/<domain>/` (Zod schemas in `lib/shared/schemas/`), never a Convex table
  or DB row.
- **Tenant isolation — nothing org-owned is shared across organizations** — any new org-owned data
  (a Convex table or field, an org config domain, a cache, a DB pool, an egress/browser-session
  store, the RAG/crawler corpora `private_knowledge`/`public_web` + their embeddings) MUST be
  scoped and queried per organization. Per-org knowledge routing is
  `getKnowledgePoolForOrg(orgSlug)`, never the deployment-default `getKnowledgePool()`; introducing
  a new cross-org shared surface is a defect.
- **A data-model or org-config schema change ships a migration** — versioned, reversible,
  idempotent; `migrations:check` fails without one. Scaffold with `bun run gen:migration` (the
  registries are generated — `migrations:sync`, never hand-edited) and follow the
  [`create-migration`](skills/create-migration/SKILL.md) skill.
- **Every locale is covered, always** — a user-visible string never ships in fewer languages than
  the app supports: adding/changing/removing a key touches `en` AND every sibling locale (`de`,
  `fr`, `de-CH` overrides, `packages/ui` messages, docs trees) in the same change, following the
  [`write-translations`](skills/write-translations/SKILL.md) skill. A key present in one catalog
  and missing in another is a defect, not a follow-up.
- **Scaffold new parts from templates** — beyond the shared `gen:package|service|tool|skill`, tale
  adds `bun run gen:migration` and `bun run gen:episode` (docs-video episodes).
- **Pencil**: `design/docs/comments.md` is strictly designer↔developer UI communication. Put
  code-level bug analysis in a GitHub issue, never there.
- **Git**: branch off `main`, never commit to it; PRs squash-merge (linear history), so the PR
  title must itself be commitlint-shaped.

## Skills index

Repo-dev skills live in [`.agents/skills/`](skills/); run `bun run skills:sync` after editing one.

| Skill                                                       | Read before…                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [`create-migration`](skills/create-migration/SKILL.md)      | adding/changing/testing a versioned data migration, or a red `migrations:check` / corpus gate       |
| [`write-docs`](skills/write-docs/SKILL.md)                  | writing/editing any end-user docs page — journey-first, with the repo facts in `docs/AGENTS.md`      |
| [`write-translations`](skills/write-translations/SKILL.md)  | editing any non-English locale file or doc, or touching the glossary                                 |

The product skills are not repo-dev workflows: they live under
[`configs/platform/custom/skills/`](../configs/platform/custom/skills/) as the builtin catalog every
org is seeded with — `visual-aspect-analyzer` (also baked into the sandbox image for its
Playwright/Chromium deps) plus the official document skills `docx`, `pdf`, `pptx`, `xlsx`.

## Lint debt ledger

The shared `.oxlintrc.json` enforces rules this codebase has not paid down yet; the nested
workspace configs carry the explicit relaxations. Tightening one of these back to the shared
default means deleting the override and fixing what surfaces:

- **React Compiler family** (`react/refs`, `react/set-state-in-effect`,
  `react/exhaustive-effect-dependencies`, `react/memo-dependencies`, `react/immutability`,
  `react/purity`, `react/no-deriving-state-in-effects`, `react/hooks`, and friends) — off in
  `services/platform`, `services/web`, `services/docs`, `packages/ui` (~450 sites, 2026-08).
- **`promise/always-return`** — off in the same four workspaces.
- **`import/no-cycle`** — off in `services/platform` only (21 cycles, 2026-08).
- **jsx-a11y trio** (`no-noninteractive-element-to-interactive-role`, `interactive-supports-focus`,
  `no-noninteractive-element-interactions`, `no-noninteractive-tabindex`) — off in
  `services/platform` only (11 sites needing real markup work, 2026-08).
- `typescript/no-unnecessary-type-assertion` is relaxed for platform test files: the tsgolint 7
  engine false-positives on widening assertions over frozen literals and on mock returns.
