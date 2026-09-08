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
10. **Land it** — meet the shared definition of done, atomic commits, pushed straight to
    `main`; no branch and no PR unless the repo contract says otherwise.

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
| Types                   | the root `tsconfig.*.json` family — leaves only `extends`       |
| Commit format & scopes  | `.commitlintrc.json`                                           |
| Security / SAST         | `tools/opengrep/` — `bun run lint:sast` (where present)        |
| Manual tests            | any `tests/manual/readme.md` — `bun run lint:manual`           |
| Repo specifics          | `.agents/repo.md`                                              |
| Everything at once      | `bun run check`                                                |

The **guards are the spec** — run `bun run check` and read the failures; they teach the house
style faster than prose. **When you add a rule, add its guard** — a rule no test enforces rots.

## Manual tests

Every deployable unit carries a manual layer at `<unit>/tests/manual/`, in the same shape in
every repository, scaffolded by the generator and gated by `bun run lint:manual`. It holds
what a headless run cannot judge — layout, focus, print, live reactivity across two sessions,
degraded modes, exploratory pokes:

| Path                           | What it is                                                    |
| ------------------------------ | ------------------------------------------------------------- |
| `readme.md`                    | how a round runs · box grammar · judging · severity · failure policy |
| `setup.md`                     | toolchain · stack + ports · reset choreography · accounts · baseline |
| `template.md`                  | the shape of a NEW suite, and the authoring conventions       |
| `suites/<name>.md`             | the tests — evergreen, re-runnable, **never ticked in place** |
| `reference/automation.md`      | what the automated specs already own                          |
| `reference/not-a-finding.md`   | out of scope · quirks · benign console output · debt (`BL-n`) |
| `reference/error-codes.md`     | every error code, and how to provoke it                       |
| `reference/pins.md`            | why a box says what it says — keyed by box, never by round    |
| `runs/`                        | the journal, its two templates, and one `r<nnnn>.md` per round |

**Suites and rounds are separate things.** A suite is a test: evergreen, re-runnable, and never
carrying a tick or a finding. A round is history: it ticks a session log **outside** the repo and
lands as one record in `runs/`. A box is one line — ``- [ ] `ID` · **action** → judgment.`` — and
its **ID is a stable contract**: each suite declares the prefix its boxes carry, IDs are unique
per unit, and you append, never renumber. **Ship new behaviour with its box**, or with a row in
`reference/automation.md` when a spec owns it end to end.

## Non-negotiable boundaries

Safety and architecture invariants — they hold even where no linter covers them:

- **Never destroy state without explicit permission** — local databases, caches, config files,
  seed data, fixtures. Assume every file on disk is the user's in-progress work.
- **Secrets live in environment variables only** — never hardcode or commit them; scrub logs.
- **Validate at every boundary** — user input, external APIs, webhooks; parameterized queries
  only, never string-built SQL or shell.
- **Accessibility is WCAG 2.1 AA** — real HTML, keyboard reachable, visible focus, labelled
  controls, AA contrast.
- **Commits** follow `.commitlintrc.json` (atomic, imperative, ≤72-char header) and land
  **directly on `main`** — no feature branch, no pull request, unless the repo contract says
  otherwise. **Never add `Co-Authored-By` or "Generated with Claude Code" / any attribution
  line** — `.husky/commit-msg` strips such trailers before commitlint runs.
- **A change is rarely one file** — sweep the concept's blast radius: a user-visible string →
  every locale the repo ships (+ docs); a new UI element → label + a11y + docs + tests; an env
  var / flag / API field → docs + `.env.example` + the READMEs. The guards catch the big ones —
  run them.
- **One TypeScript config** — a workspace `tsconfig.json` is exactly one key, `extends`, and
  holds NO `compilerOptions`, `include`, or `exclude`. Every option lives in the root family,
  and a leaf picks the member that fits:

  | Member                 | Adds                                          |
  | ---------------------- | --------------------------------------------- |
  | `tsconfig.base.json`   | everything; bun + node types, no DOM           |
  | `tsconfig.dom.json`    | the DOM libs                                   |
  | `tsconfig.vite.json`   | DOM + `vite/client`                            |
  | `tsconfig.node.json`   | node types ONLY — for code that runs on node   |
  | `tsconfig.strict.json` | `noUncheckedIndexedAccess`                     |
  | `tsconfig.convex.json` | Convex's required settings                     |

  The base reaches into each workspace through `${configDir}`, so `include`/`exclude` need no
  per-leaf copy. Need an option one workspace alone wants? Add a family member — never a key in
  the leaf. Unused locals/params are the LINTER's job (`eslint/no-unused-vars`, which honours
  the `^_` prefix); never add `noUnusedLocals`/`noUnusedParameters` here, or the two guards
  disagree.
- **Scaffold a new part** (package / service / tool / skill) from a template (`bun run gen …`),
  never hand-rolled — so it carries the standard configs, the test layout and the manual layer.
- **Reach for a well-known, maintained library** before hand-rolling — prefer the established
  package over a custom solution; write it yourself only when no suitable library exists.
- **Instructions are docs too** — change a path, command, or pattern a skill or an agent contract
  documents, and update it in the same change.

## Skills

Repo-dev skills live in [`.agents/skills/`](.agents/skills/); `bun run skills:sync` mirrors them
into `.claude/skills/` as a plain copy — Claude Code reads the mirror, while Cursor/Codex/Copilot
read `.agents/skills/` directly. After editing a skill, run `bun run skills:sync`; never hand-edit
the `.claude/skills/` mirror. Each repo's skill index lives in [`.agents/repo.md`](.agents/repo.md).
