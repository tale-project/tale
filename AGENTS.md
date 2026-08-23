# Working in this repository

The shared contract for every coding agent in every tale-project repository. Read it, then read
[`.agents/repo.md`](.agents/repo.md) — the repo-specific contract — before your first change.

Repositories are Bun workspaces (with Turborepo where there is more than one workspace); a
workspace script runs through `bun run --filter <workspace> <script>`.

## Read the repo contract next

[`.agents/repo.md`](.agents/repo.md) is the per-repo file: layout, stack, domain rules, extra
gates, and the debt ledger. This shared file never carries repo facts — if a fact is specific to
one repository, it belongs there. When the two seem to disagree, the repo contract wins.

## How to work

The biggest quality lever is deciding well, not typing fast. Work in this order:

1. **Classify the task** and follow its discipline end-to-end: a defect (find the root cause, lock
   it with a regression test); structure-not-behaviour (refactor without changing behaviour); new
   behaviour (a feature, screen, endpoint, or flag); a review (an adversarial read before merge).
   Exploring is read-only and returns the conclusion; a migration is phased and reversible, each
   phase green.
2. **Write a short planning note first** — capture intent, status quo, and plan before any edit;
   keep scratch files in your global notes directory, never in the clone.
3. **Unknowns outside the repo?** Research before deciding — questions first, sources in order,
   evidence in the note.
4. **Search before you write** — orient, find the concept to reuse, enumerate the blast radius.
   The request names one site; the task is the concept.
5. **UI in scope?** Learn the repo's design system first — where it lives is in
   [`.agents/repo.md`](.agents/repo.md) — then build to it.
6. **Too big for one thread?** Split it into disjoint units with complete briefs; you keep the
   done-gate.
7. **Do the work** thin and reversible, following the discipline you classified — ask the moment a
   fork or roadblock appears; never guess.
8. **Prove it** — tests carry the change; observe the real outcome; drive web UIs in a real
   browser.
9. **Review your own diff** — adversarial read, then the automated reviewers.
10. **Land it** — meet the shared definition of done, atomic commits, one focused PR.

Every code-writing task passes **two gates**. **Gate A — before code:** note · intent · status quo
· reuse · conventions · blast radius — a divergent second copy of an existing concept is a defect,
not a feature. **Gate B — before done:** the shared definition of done — green gate · security ·
tests · migration/data · locales (where the repo ships them) · docs · accessibility · sweep ·
observed · commits. **Never claim a success you haven't observed.**

## Discover the conventions — don't memorize them

This file does not list the coding rules; the repo's own tooling does, and it can't drift. Read
the enforced source and match it (orient in the repo first, then read the surrounding code):

| To learn…               | Read / run                                                     |
| ----------------------- | -------------------------------------------------------------- |
| Lint rules & code style | `.oxlintrc.json` (+ nested per-workspace extends)              |
| Formatting              | `oxfmt` (`bun run format` + the edit hook) — never hand-format |
| Types                   | the `tsconfig.base.json` chain (strict)                        |
| Commit format & scopes  | `.commitlintrc.json`                                           |
| Security / SAST         | `tools/opengrep/` — `bun run lint:sast` (where present)        |
| Repo specifics          | `.agents/repo.md`                                              |
| Everything at once      | `bun run check`                                                |

The **guards are the spec** — run `bun run check` and read the failures; they teach the house
style faster than prose. **When you add a rule, add its guard** — a rule no test enforces rots.

## Non-negotiable boundaries

Safety and architecture invariants — they hold even where no linter covers them:

- **Never destroy state without explicit permission** — local databases, caches, config files,
  seed data, fixtures. Assume every file on disk is the user's in-progress work.
- **Secrets live in environment variables only** — never hardcode or commit them; scrub logs.
- **Validate at every boundary** — user input, external APIs, webhooks; parameterized queries
  only, never string-built SQL or shell.
- **Accessibility is WCAG 2.1 AA** — real HTML, keyboard reachable, visible focus, labelled
  controls, AA contrast.
- **Commits** follow `.commitlintrc.json` (atomic, imperative, ≤72-char header); branch off
  `main` unless the repo contract says otherwise. **Never add `Co-Authored-By` or "Generated with
  Claude Code" / any attribution line** — `.husky/commit-msg` strips such trailers before
  commitlint runs.
- **A change is rarely one file** — sweep the concept's blast radius: a user-visible string →
  every locale the repo ships (+ docs); a new UI element → label + a11y + docs + tests; an env
  var / flag / API field → docs + `.env.example` + the READMEs. The guards catch the big ones —
  run them.
- **Scaffold a new part** (package / service / tool / skill) from a template (`bun run gen …`),
  never hand-rolled — so it carries the standard configs and test layout.
- **Instructions are docs too** — change a path, command, or pattern a skill or an agent contract
  documents, and update it in the same change.

## Skills

Repo-dev skills live in [`.agents/skills/`](.agents/skills/); `bun run skills:sync` mirrors them
into `.claude/skills/` as a plain copy — Claude Code reads the mirror, while Cursor/Codex/Copilot
read `.agents/skills/` directly. After editing a skill, run `bun run skills:sync`; never hand-edit
the `.claude/skills/` mirror. Each repo's skill index lives in [`.agents/repo.md`](.agents/repo.md).
