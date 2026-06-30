# Tale

The single source of truth for working in this repository, for **every** coding agent. Read it before your first change.

Tale is a monorepo on Bun workspaces; every workspace script runs through `bun run --filter @tale/<workspace> <script>`.

## How to work

The biggest quality lever is deciding well, not typing fast. **Classify the task first** — the
discipline differs by goal, and each has a skill:

- **Fix a bug** → root cause + a regression test; no drive-by refactor. ([`fix-bug`](.agents/skills/fix-bug/SKILL.md))
- **Improve / refactor** → change structure, _not_ behaviour; lock it with tests; stay green. ([`make-improvement`](.agents/skills/make-improvement/SKILL.md))
- **Implement a feature** → reuse-first, a thin vertical slice, fully integrated. ([`implement-feature`](.agents/skills/implement-feature/SKILL.md))
- **Review** → an adversarial read; propose, don't silently rewrite. ([`review-code`](.agents/skills/review-code/SKILL.md), [`review-pr`](.agents/skills/review-pr/SKILL.md))
- **Explore** → read-only, broad, return the conclusion.
- **Migrate / large change** → impact analysis first, phased and reversible, each phase green.

Every code-writing task passes **two gates** — the workflow skills make them concrete:

**Gate A — before you write any code.** _Write the note first_ (`write-notes` — answer the active
skill's form). _Check status quo_: run or navigate the real app, or
exercise the real code path, for the area you're touching — never code from imagination. _Restate the
intent_ and **ask when it's ambiguous** — a wrong guess wastes the whole change, and keep asking the
moment you hit a roadblock. _Search for the existing concept_ by vocabulary and **reuse it** — a
divergent second copy of something the app already does is a defect, not a feature. _Discover the
conventions from the tooling_ (below). _Map the blast radius_ and pick the smallest, most reversible
change. You haven't earned the right to implement until you can name the concept you're reusing — or say
why none fits.

**Gate B — before you call it done.** A data-model change ships its migration; tests carry the change
(happy + one edge + one error); user-visible strings are localized in every locale; docs are updated;
UI meets accessibility AA; and you have **observed the real outcome**, not just a green typecheck.
Consider each, then check how this repo enforces it.

**Self-review twice** — your plan before editing, your diff before "done" — then run the review skills.
**Never claim a success you haven't observed.**

## Discover the conventions — don't memorize them

This file does not list the coding rules; the repo's own tooling does, and it can't drift. Before and
while you code, read the enforced source and match it:

| To learn…               | Read / run                                                     |
| ----------------------- | -------------------------------------------------------------- |
| Lint rules & code style | `.oxlintrc.json` + the surrounding code                        |
| Formatting              | `oxfmt` (`bun run format` + the edit hook) — never hand-format |
| Types                   | the `tsconfig*.json` chain (strict)                            |
| Commit format & scopes  | `.commitlintrc.json`                                           |
| Security / SAST         | [`tools/opengrep/`](tools/opengrep/) — `bun run lint:sast`     |
| Design system & tokens  | [`design/`](design/) + [`designs/`](designs/) + `@tale/ui`     |
| Everything at once      | `bun run check` (format, lint, typecheck, all tests)           |

The **guards are the spec** — i18n parity/ICU, skeleton conventions, `migrations:check`, the docs
structural suite, accessibility (`checkAccessibility()` + `vitest-axe`), `knip`, strict typecheck. Run
`bun run check` and read the failures; they teach the house style faster than prose ever could. **When
you add a rule, add its guard** — a rule no test enforces rots.

## Non-negotiable boundaries

Safety and architecture invariants — they hold even where no linter covers them:

- **Never destroy state without explicit permission** — local DBs, Convex state, caches, config files, seed data. Assume every file on disk is the user's in-progress work.
- **Secrets live in environment variables only** — never hardcode or commit them; scrub logs.
- **Validate at every boundary** — user input, external APIs, webhooks; parameterized queries only, never string-built SQL or shell.
- **Org configuration is files, not tables** — per-org config is JSON under `$TALE_CONFIG_DIR/<org>/<domain>/` (Zod schemas in `lib/shared/schemas/`), never a Convex table or DB row.
- **A data-model or org-config schema change ships a migration** — versioned and reversible; `migrations:check` fails without one. Follow the existing migrations under `convex/migrations/versions/` (and the config-migration model there) rather than inventing a shape.
- **Accessibility is WCAG 2.1 AA** — real HTML, keyboard reachable, visible focus, labelled controls, AA contrast.
- **Commits** follow `.commitlintrc.json` (atomic, imperative, ≤72-char header); branch off `main`, never commit to it. **Never add `Co-Authored-By` or "Generated with Claude Code" / any attribution line** — repo rule, not linted.
- **A change is rarely one file.** Walk its blast radius: a user-visible string → every locale (+ docs); a new UI element → label + a11y + docs + tests; an env var / flag / API field → docs + `.env.example` + the READMEs. The guards catch the big ones — run them.
- **Scaffold a new part** (service / package / tool / skill) from a template (`bun run gen …`), never hand-rolled — so it carries the standard configs and test layout.
- **Instructions are docs too** — change a path, command, or pattern a skill or this file documents, and update it in the same change (`bun run skills:check` guards the skill set).

## Skills and guides index

Load the relevant skill before working in an area — it carries the how-to this contract deliberately
omits. Adding, renaming, or removing a skill updates this table (it is the map every agent reads) and
runs `bun run skills:sync`; the authoring standard is
[`write-skill`](.agents/skills/write-skill/SKILL.md).

**Two homes.** The **workflow skills** are generic, portable senior-dev guides whose source of truth is
[`builtin-configs/skills/<name>/`](builtin-configs/skills/) — they ship to product org agents **and** are
projected (by `skills:sync`, via the `WORKFLOW_SKILLS` allowlist in
[`tools/skills/src/sync.ts`](tools/skills/src/sync.ts)) into [`.agents/skills/<name>/`](.agents/skills/)
for repo-dev agents. The **authoring skills** are Tale-specific and live only under `.agents/skills/`.
Both are mirrored to a generated `.claude/skills/` for Claude Code — **never hand-edit a generated copy**
(`bun run skills:check`, a CI test, fails on drift). Product-only document skills (`pptx`, …) and the
integrated Bun-workspace skills under [`skills/`](skills/) are not projected.

| Skill                                                              | Read before…                                                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [`write-notes`](.agents/skills/write-notes/SKILL.md)               | starting work under any other skill — answer its note form and write the note first |
| [`implement-feature`](.agents/skills/implement-feature/SKILL.md)   | adding new behaviour — a feature, screen, endpoint, flag, or capability             |
| [`make-improvement`](.agents/skills/make-improvement/SKILL.md)     | refactoring, optimizing, or deduplicating — changing structure, not behaviour       |
| [`implement-ui`](.agents/skills/implement-ui/SKILL.md)             | writing or editing any UI — a component, screen, page, or route (app, web, docs)    |
| [`design-ui`](.agents/skills/design-ui/SKILL.md)                   | any visual/UI work, or reading the design files — app vs web, colours + tokens      |
| [`fix-bug`](.agents/skills/fix-bug/SKILL.md)                       | chasing a bug to its root cause and locking it with a regression test               |
| [`review-code`](.agents/skills/review-code/SKILL.md)               | reviewing a working diff — yours or a colleague's — before it merges                |
| [`review-pr`](.agents/skills/review-pr/SKILL.md)                   | reviewing a GitHub pull request end-to-end                                          |
| [`create-pr`](.agents/skills/create-pr/SKILL.md)                   | taking a finished change to a clean, mergeable PR (gate + ripple + commit)          |
| [`test-code`](.agents/skills/test-code/SKILL.md)                   | writing tests, or proving behaviour by observing the real outcome                   |
| [`write-skill`](.agents/skills/write-skill/SKILL.md)               | adding, editing, or moving a skill                                                  |
| [`write-docs`](.agents/skills/write-docs/SKILL.md)                 | writing/editing a docs page, or running the docs test suite                         |
| [`write-translations`](.agents/skills/write-translations/SKILL.md) | editing any non-English locale file or doc, or touching the glossary                |

Built-in harness skills cover the rest — `react-doctor` (React smells), `code-review` / `security-review`
(automated diff review), `claude-api`, `deep-research`, `update-config`. Use them; don't reimplement them.
