# Tale

The single source of truth for working in this repository, for **every** coding agent. Read it before your first change.

Tale is a monorepo on Bun workspaces; every workspace script runs through `bun run --filter @tale/<workspace> <script>`.

## How to work

The biggest quality lever is deciding well, not typing fast. Work in this order:

1. **Classify the task** and follow its discipline end-to-end: a defect (find the root cause, lock it with a regression test); structure-not-behaviour (refactor without changing behaviour); new behaviour (a feature, screen, endpoint, or flag); a review (an adversarial read before merge). Exploring is read-only and returns the conclusion; a migration is phased and reversible, each phase green.
2. **Write a short planning note first** — capture intent, status quo, and plan before any edit; keep scratch files in your global notes directory, never in the clone.
3. **Unknowns outside the repo?** Research before deciding — questions first, sources in order, evidence in the note.
4. **Search before you write** — orient, find the concept to reuse, enumerate the blast radius. The request names one site; the task is the concept.
5. **UI in scope?** Learn the design system in [`design/`](design/) and `@tale/ui`, then build to it.
6. **Too big for one thread?** Split it into disjoint units with complete briefs; you keep the done-gate.
7. **Do the work** thin and reversible, following the discipline you classified — ask the moment a fork or roadblock appears; never guess.
8. **Prove it** — tests carry the change; observe the real outcome; drive web UIs in a real browser.
9. **Review your own diff** — adversarial read, then the automated reviewers.
10. **Land it** — meet the shared definition of done, atomic commits, one focused PR.

Every code-writing task passes **two gates**. **Gate A — before
code:** note · intent · status quo · reuse · conventions · blast radius — a divergent second copy of an
existing concept is a defect, not a feature. **Gate B — before done:** the shared definition of done —
green gate · security · tests · migration · locales · docs · accessibility · sweep · observed · commits.
**Never claim a success you haven't observed.**

## Discover the conventions — don't memorize them

This file does not list the coding rules; the repo's own tooling does, and it can't drift. Read the
enforced source and match it (orient in the repo first, then read the surrounding code):

| To learn…               | Read / run                                                     |
| ----------------------- | -------------------------------------------------------------- |
| Lint rules & code style | `.oxlintrc.json` + the surrounding code                        |
| Formatting              | `oxfmt` (`bun run format` + the edit hook) — never hand-format |
| Types                   | the `tsconfig*.json` chain (strict)                            |
| Commit format & scopes  | `.commitlintrc.json`                                           |
| Security / SAST         | [`tools/opengrep/`](tools/opengrep/) — `bun run lint:sast`     |
| Design system & tokens  | [`design/`](design/) (`docs/` + `sources/`) + `@tale/ui`       |
| Everything at once      | `bun run check` (format, lint, typecheck, all tests)           |

The **guards are the spec** — run `bun run check` and read the failures; they teach the house style
faster than prose. **When you add a rule, add its guard** — a rule no test enforces rots.

## Non-negotiable boundaries

Safety and architecture invariants — they hold even where no linter covers them:

- **Never destroy state without explicit permission** — local DBs, Convex state, caches, config files, seed data. Assume every file on disk is the user's in-progress work. **Never run `bun run setup:clean`** (wipes `services/platform/.convex/local/`) unless the user explicitly asked to delete their local Convex dev data — automatic dev maintenance handles module bloat; the clean script requires typing `delete local convex` on purpose.
- **Secrets live in environment variables only** — never hardcode or commit them; scrub logs.
- **Validate at every boundary** — user input, external APIs, webhooks; parameterized queries only, never string-built SQL or shell.
- **Org configuration is files, not tables** — per-org config is JSON under `$TALE_CONFIG_DIR/<org>/<domain>/` (Zod schemas in `lib/shared/schemas/`), never a Convex table or DB row.
- **Tenant isolation — nothing org-owned is shared across organizations** — any new org-owned data (a Convex table or field, an org config domain, a cache, a DB pool, an egress/browser-session store, the RAG/crawler corpora `private_knowledge`/`public_web` + their embeddings) MUST be scoped and queried per organization. Per-org knowledge routing is `getKnowledgePoolForOrg(orgSlug)`, never the deployment-default `getKnowledgePool()`; introducing a new cross-org shared surface is a defect.
- **A data-model or org-config schema change ships a migration** — versioned, reversible, idempotent; `migrations:check` fails without one. Scaffold with `bun run gen:migration` (the registries are generated — `migrations:sync`, never hand-edited) and follow [`create-migration`](.agents/skills/create-migration/SKILL.md).
- **Accessibility is WCAG 2.1 AA** — real HTML, keyboard reachable, visible focus, labelled controls, AA contrast.
- **Commits** follow `.commitlintrc.json` (atomic, imperative, ≤72-char header); branch off `main`, never commit to it. **Never add `Co-Authored-By` or "Generated with Claude Code" / any attribution line** — `.husky/commit-msg` strips Cursor/Claude attribution trailers before commitlint runs.
- **A change is rarely one file** — sweep the concept's blast radius: a user-visible string → every locale (+ docs); a new UI element → label + a11y + docs + tests; an env var / flag / API field → docs + `.env.example` + the READMEs. The guards catch the big ones — run them.
- **Every locale is covered, always** — a user-visible string never ships in fewer languages than the app supports: adding/changing/removing a key touches `en` AND every sibling locale (`de`, `fr`, `de-CH` overrides, `packages/ui` messages, docs trees) in the same change, following [`write-translations`](.agents/skills/write-translations/SKILL.md). A key present in one catalog and missing in another is a defect, not a follow-up.
- **Scaffold a new part** (service / package / tool / skill / migration / video episode) from a template (`bun run gen …`), never hand-rolled — so it carries the standard configs and test layout.
- **Instructions are docs too** — change a path, command, or pattern a skill or this file documents, and update it in the same change; after editing a skill, run `bun run skills:sync` to refresh the `.claude/skills/` mirror.

## Skills and guides index

Repo-dev skills live in [`.agents/skills/`](.agents/skills/); `bun run skills:sync` mirrors them into
`.claude/skills/` as a plain copy — Claude Code reads the mirror, while Cursor/Codex/Copilot read
`.agents/skills/` directly. Adding, renaming, or removing a skill updates this table and re-runs that
copy; never hand-edit the `.claude/skills/` mirror.

The skill set is being rebuilt after the AI-backend rewrite, so this index is deliberately short — only
the three skills below exist today, and the earlier workflow guides were removed rather than restored.
The product skills are not repo-dev workflows: they live under
[`configs/platform/custom/skills/`](configs/platform/custom/skills/) as the builtin catalog every org is
seeded with — `visual-aspect-analyzer` (also baked into the sandbox image for its Playwright/Chromium
deps) plus the official document skills `docx`, `pdf`, `pptx`, `xlsx`, whose bundles are staged into a
session when equipped.

| Skill                                                              | Read before…                                                                                                      |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| [`create-migration`](.agents/skills/create-migration/SKILL.md)     | adding/changing/testing a versioned data migration, or a red `migrations:check` / corpus gate                     |
| [`write-docs`](.agents/skills/write-docs/SKILL.md)                 | writing/editing any end-user docs page — journey-first, with the repo facts in [`docs/AGENTS.md`](docs/AGENTS.md) |
| [`write-translations`](.agents/skills/write-translations/SKILL.md) | editing any non-English locale file or doc, or touching the glossary                                              |

Built-in harness skills cover the rest — `react-doctor` (React smells), `code-review` / `security-review`
(automated diff review), `claude-api`, `update-config`. Use them; don't reimplement them.
