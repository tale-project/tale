# Tale

The single source of truth for working in this repository, for **every** coding agent. Read it before your first change.

Tale is a monorepo on Bun workspaces; every workspace script runs through `bun run --filter @tale/<workspace> <script>`.

## How to work

The biggest quality lever is deciding well, not typing fast. Work in this order — each step is a skill; load it:

1. **Classify the task** and follow its discipline end-to-end: a defect → [`fix-bug`](.agents/skills/fix-bug/SKILL.md); structure-not-behaviour → [`make-improvement`](.agents/skills/make-improvement/SKILL.md); new behaviour → [`implement-feature`](.agents/skills/implement-feature/SKILL.md); a review → [`review-code`](.agents/skills/review-code/SKILL.md) / [`review-pr`](.agents/skills/review-pr/SKILL.md). Exploring is read-only and returns the conclusion; a migration is phased and reversible, each phase green.
2. **Write the note first** ([`write-notes`](.agents/skills/write-notes/SKILL.md)) — answer the active skill's form before any edit; scratch files go in the global notes directory the skill defines, never in the clone.
3. **Unknowns outside the repo?** Research before deciding ([`deep-research`](.agents/skills/deep-research/SKILL.md)) — questions first, sources in order, evidence in the note.
4. **Search before you write** ([`search-codebase`](.agents/skills/search-codebase/SKILL.md)) — orient, find the concept to reuse, enumerate the blast radius. The request names one site; the task is the concept.
5. **UI in scope?** Learn the design system ([`design-ui`](.agents/skills/design-ui/SKILL.md)), then build to it ([`implement-ui`](.agents/skills/implement-ui/SKILL.md)).
6. **Too big for one thread?** Split it ([`delegate-work`](.agents/skills/delegate-work/SKILL.md)) — disjoint units, complete briefs; you keep the done-gate.
7. **Do the work** thin and reversible, under the classified skill — ask the moment a fork or roadblock appears; never guess.
8. **Prove it** ([`test-code`](.agents/skills/test-code/SKILL.md)) — tests carry the change; observe the real outcome; drive web UIs with [`browse-web`](.agents/skills/browse-web/SKILL.md).
9. **Review your own diff** ([`review-code`](.agents/skills/review-code/SKILL.md)) — adversarial read, then the automated reviewers.
10. **Land it** ([`create-pr`](.agents/skills/create-pr/SKILL.md)) — the shared definition of done, atomic commits, one focused PR.

Every code-writing task passes **two gates**, carried as checklists by the skills. **Gate A — before
code:** note · intent · status quo · reuse · conventions · blast radius — a divergent second copy of an
existing concept is a defect, not a feature. **Gate B — before done:** the shared definition of done —
green gate · security · tests · migration · locales · docs · accessibility · sweep · observed · commits
— [`create-pr`](.agents/skills/create-pr/SKILL.md) owns the full checklist. **Never claim a success you
haven't observed.**

## Discover the conventions — don't memorize them

This file does not list the coding rules; the repo's own tooling does, and it can't drift. Read the
enforced source and match it (the generic method is `search-codebase`'s orient step):

| To learn…               | Read / run                                                     |
| ----------------------- | -------------------------------------------------------------- |
| Lint rules & code style | `.oxlintrc.json` + the surrounding code                        |
| Formatting              | `oxfmt` (`bun run format` + the edit hook) — never hand-format |
| Types                   | the `tsconfig*.json` chain (strict)                            |
| Commit format & scopes  | `.commitlintrc.json`                                           |
| Security / SAST         | [`tools/opengrep/`](tools/opengrep/) — `bun run lint:sast`     |
| Design system & tokens  | [`design/`](design/) + [`designs/`](designs/) + `@tale/ui`     |
| Everything at once      | `bun run check` (format, lint, typecheck, all tests)           |

The **guards are the spec** — run `bun run check` and read the failures; they teach the house style
faster than prose. **When you add a rule, add its guard** — a rule no test enforces rots.

## Non-negotiable boundaries

Safety and architecture invariants — they hold even where no linter covers them:

- **Never destroy state without explicit permission** — local DBs, Convex state, caches, config files, seed data. Assume every file on disk is the user's in-progress work. **Never run `bun run setup:clean`** (wipes `services/platform/.convex/local/`) unless the user explicitly asked to delete their local Convex dev data — automatic dev maintenance handles module bloat; the clean script requires typing `delete local convex` on purpose.
- **Secrets live in environment variables only** — never hardcode or commit them; scrub logs.
- **Validate at every boundary** — user input, external APIs, webhooks; parameterized queries only, never string-built SQL or shell.
- **Org configuration is files, not tables** — per-org config is JSON under `$TALE_CONFIG_DIR/<org>/<domain>/` (Zod schemas in `lib/shared/schemas/`), never a Convex table or DB row.
- **A data-model or org-config schema change ships a migration** — versioned and reversible; `migrations:check` fails without one. Follow the existing migrations under `convex/migrations/versions/` rather than inventing a shape.
- **Accessibility is WCAG 2.1 AA** — real HTML, keyboard reachable, visible focus, labelled controls, AA contrast.
- **Commits** follow `.commitlintrc.json` (atomic, imperative, ≤72-char header); branch off `main`, never commit to it. **Never add `Co-Authored-By` or "Generated with Claude Code" / any attribution line** — repo rule, not linted.
- **A change is rarely one file** — sweep the concept's blast radius (`search-codebase`): a user-visible string → every locale (+ docs); a new UI element → label + a11y + docs + tests; an env var / flag / API field → docs + `.env.example` + the READMEs. The guards catch the big ones — run them.
- **Scaffold a new part** (service / package / tool / skill) from a template (`bun run gen …`), never hand-rolled — so it carries the standard configs and test layout.
- **Instructions are docs too** — change a path, command, or pattern a skill or this file documents, and update it in the same change (`bun run skills:check` guards the skill set).

## Skills and guides index

Adding, renaming, or removing a skill updates this table and runs `bun run skills:sync`; the authoring
standard is [`write-skill`](.agents/skills/write-skill/SKILL.md). **Two homes:** workflow skills are
generic and portable — their source of truth is [`builtin-configs/skills/<name>/`](builtin-configs/skills/)
(shipped to product org agents), projected via the `WORKFLOW_SKILLS` allowlist in
[`tools/skills/src/sync.ts`](tools/skills/src/sync.ts) into [`.agents/skills/`](.agents/skills/); authoring
skills are Tale-specific and live only under `.agents/skills/`. Both mirror into a generated
`.claude/skills/` — **never hand-edit a generated copy** (`bun run skills:check` fails on drift). Document
skills (`pptx`, …) and the workspace skills under [`skills/`](skills/) are product-only, not projected.

| Skill                                                              | Read before…                                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| [`write-notes`](.agents/skills/write-notes/SKILL.md)               | starting work under any other skill — answer its note form and write the note first               |
| [`search-codebase`](.agents/skills/search-codebase/SKILL.md)       | touching code anywhere — orient in the repo, find the concept to reuse, sweep every affected site |
| [`deep-research`](.agents/skills/deep-research/SKILL.md)           | deciding on facts you don't have — a new domain, dependency, API, or load-bearing claim           |
| [`delegate-work`](.agents/skills/delegate-work/SKILL.md)           | splitting a big task across subagents — disjoint units, complete briefs, you own the merge        |
| [`browse-web`](.agents/skills/browse-web/SKILL.md)                 | driving a real browser — verify a web UI, reproduce a web bug, research a JS-heavy page           |
| [`implement-feature`](.agents/skills/implement-feature/SKILL.md)   | adding new behaviour — a feature, screen, endpoint, flag, or capability                           |
| [`make-improvement`](.agents/skills/make-improvement/SKILL.md)     | refactoring, optimizing, or deduplicating — changing structure, not behaviour                     |
| [`implement-ui`](.agents/skills/implement-ui/SKILL.md)             | writing or editing any UI — a component, screen, page, or route (app, web, docs)                  |
| [`design-ui`](.agents/skills/design-ui/SKILL.md)                   | any visual/UI work, or reading the design files — app vs web, colours + tokens                    |
| [`fix-bug`](.agents/skills/fix-bug/SKILL.md)                       | chasing a bug to its root cause and locking it with a regression test                             |
| [`review-code`](.agents/skills/review-code/SKILL.md)               | reviewing a working diff — yours or a colleague's — before it merges                              |
| [`review-pr`](.agents/skills/review-pr/SKILL.md)                   | reviewing a GitHub pull request end-to-end                                                        |
| [`create-pr`](.agents/skills/create-pr/SKILL.md)                   | taking a finished change to a clean, mergeable PR (gate + ripple + commit)                        |
| [`create-issue`](.agents/skills/create-issue/SKILL.md)             | filing a GitHub issue — dedupe first, grounded repro + code pointers, house format, labels        |
| [`test-code`](.agents/skills/test-code/SKILL.md)                   | writing tests, or proving behaviour by observing the real outcome                                 |
| [`write-skill`](.agents/skills/write-skill/SKILL.md)               | adding, editing, or moving a skill                                                                |
| [`write-docs`](.agents/skills/write-docs/SKILL.md)                 | writing/editing a docs page, or running the docs test suite                                       |
| [`write-translations`](.agents/skills/write-translations/SKILL.md) | editing any non-English locale file or doc, or touching the glossary                              |

Built-in harness skills cover the rest — `react-doctor` (React smells), `code-review` / `security-review`
(automated diff review), `claude-api`, `update-config`. Use them; don't reimplement them.
