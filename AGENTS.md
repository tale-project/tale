# Tale — the coding contract

The single source of truth for working in this repository, for **every** coding agent (Claude Code,
Cursor, Codex, Copilot, Gemini CLI). Read it in full before your first change. Depth lives in the
on-demand guides under [`.claude/skills/`](.claude/skills/) — this file is the contract; the skills
are the how-to. The index is at the bottom.

Tale is a monorepo on Bun workspaces. Every workspace script runs through the filter:

```bash
bun run --filter @tale/<workspace> <script>
```

## How to work

Understand the request and the code around it before touching anything. **Look before you build:**
search the design system ([`packages/ui`](packages/ui/)), then shared `app/`/`lib/` code, then the
feature — reuse or extend what exists; don't reinvent it. Plan non-trivial work. Implement in atomic
commits that match the conventions of the files you're already in. Then **prove it works** — run the
gate and observe the real outcome. Finally, walk the **Ripple Map**: a change is rarely one file.

## Think like a senior engineer

The biggest quality lever is deciding well, not typing fast. Before you act:

**1. Classify the task — the method differs by goal.**

| Mode                       | Goal                                 | Discipline (and what to avoid)                                                                                                                         |
| -------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Fix** a bug              | Kill the root cause, not the symptom | Reproduce → write the failing regression test → **minimal** targeted fix → confirm green. Avoid scope creep and drive-by refactors.                    |
| **Refactor**               | Change structure, **not** behaviour  | Lock behaviour with tests first → small reversible steps → stay green throughout → never fold in a feature. Prefer incremental + reuse over a rewrite. |
| **Implement** a feature    | New behaviour, fully integrated      | Understand intent → design → reuse-first → vertical slice → Definition of Done + Ripple Map → verify. Avoid gold-plating and speculative generality.   |
| **Review**                 | Find what's wrong                    | Adversarial read (correctness/security/edge/reuse/simplicity); propose, don't silently rewrite.                                                        |
| **Explore**                | Understand                           | Read-only, broad, return the conclusion. No edits.                                                                                                     |
| **Migrate / large change** | Move safely at scale                 | Impact + dependents analysis first → phased, reversible → each phase green. Never a big-bang irreversible change.                                      |

**2. Think twice (pre-flight).** Restate the intent in your own words; if it's ambiguous or has
hidden forks, **ask** — don't guess. Map the blast radius (Ripple Map) and the dependents (who
imports/calls this). Weigh at least one alternative; pick the **smallest correct, most reversible**
change. Name the risk and the rollback. **Never make a radical change without first understanding its
impact.**

**3. Self-review twice.** Critique your own _plan_ before editing (right altitude? least-radical?
consistent with the repo?). Re-read your own _diff_ before "done" (correctness, edge cases, security,
reuse, simplicity, convention-match, Ripple satisfied), then run [`review`](.claude/skills/review/SKILL.md).

**4. Know when to stop and ask.** Irreversible/destructive ops, ambiguous intent, architectural
forks, or anything contradicting what you were told → pause and surface it. Thinking is cheaper than a
wrong radical change. → Full guide: [`engineering-approach`](.claude/skills/engineering-approach/SKILL.md), [`plan`](.claude/skills/plan/SKILL.md)

## Before you open a PR

This is the first thing you check, not the last. Skipping the docs/translations sync is the most
common failure mode for agent PRs here — every rule below exists because it was skipped before.

**Does this change need docs and translations?** Walk top-down; first **yes** wins:

- Added/renamed/removed a key in `services/platform/messages/`? → **Yes.**
- Added/changed/removed a UI element a user can click, see, or read? → **Yes.**
- Added/renamed/removed/changed the default of an env var, CLI flag, config key, or API field? → **Yes.**
- Changed error wording, validation, or rate limits a user can hit? → **Yes.**
- Pure refactor, internal type, test, build script, or comment? → **No.** Note the scope in the commit body.

If unsure, default to **yes**. Reviewer time is cheaper than stale docs.

### Definition of Done

"Done" is not "the code compiles." Done is: every applicable box below is ticked or explicitly marked
N/A in the commit body, the gate is green, and you have _observed_ the change behaving as intended.
If you didn't verify it, it isn't done — say so rather than claiming it. Paste this into the PR:

- [ ] Ran `bun run check` (format, lint, typecheck, all tests).
- [ ] Ran `bun run lint:sast` (Opengrep, a required CI gate): clean, or a true false-positive narrowly suppressed with a justified `nosemgrep`.
- [ ] Data-model change ships its migration in the same PR, verified on a fresh stack — Convex shape changes under `convex/migrations/versions/` with `bun run --filter @tale/platform migrations:check` green; knowledge-DB (Postgres) schema under `services/db/migrations/` (dbmate) — or N/A.
- [ ] Ran `bun run test:e2e` for any touched frontend service (`platform`/`web`/`docs`) — or N/A.
- [ ] Loading uses `<Skeletonize>` + skeleton-aware leaves — no hand-rolled skeletons or magic `h-[…]` — or N/A.
- [ ] Updated `services/platform/messages/{en,de,fr}.json` (+ `de-CH` overrides where the value differs) — or N/A.
- [ ] Updated `/docs/{en,de,fr}/` for every user-visible change, with a real opening + closing — or N/A.
- [ ] Tests carry the change: unit (happy + one edge + one error), and a manual QA guide for user-visible behaviour — or N/A.
- [ ] Updated `README.md`, `README.de.md`, `README.fr.md` — or N/A.
- [ ] Verified the real outcome (ran it / browser / Convex MCP), not just inspected the diff.
- [ ] Instructions current — if you changed a path, command, or pattern a skill or `AGENTS.md` documents, updated it (skills are docs too) — or N/A.

### The Ripple Map — change X → also touch Y

A change is rarely one file. Expand a local edit into its blast radius:

| You changed…                                             | You must also…                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A user-visible string                                    | `en/de/fr.json` (+`de-CH` if differs) · glossary · docs(3) · manual guide · e2e                 |
| A translation key (add/rename/remove)                    | all base locales same commit · remove dead keys everywhere                                      |
| A new interactive UI element                             | i18n label · a11y (HTML/keyboard/aria/contrast/24px) · docs · manual guide · e2e                |
| A new `components/ui/` primitive                         | Storybook story (all variants) · a11y block · Skeletonize support                               |
| A Convex field/table (rename/retype/split/drop/backfill) | migration + up/down + `migration.test.ts` + registry + `migrations:check`                       |
| A knowledge-DB schema                                    | dbmate migration under `migrations/knowledge-db/<schema>/` · verify a fresh `compose up`        |
| Env var / CLI flag / config key / API field              | docs(3) · `.env.example` · `README{,.de,.fr}.md` · setup                                        |
| Error wording / validation / rate limit                  | docs(3) · tests · i18n                                                                          |
| A date display                                           | `useFormatDate()` — never `toLocale*`                                                           |
| A new query/mutation                                     | `queryWithRLS`/`mutationWithRLS` · validators · no `.collect()` · preload in the loader         |
| A path/command/pattern a skill or `AGENTS.md` documents  | update that guide + the skill index · run `bun .claude/check-skill-links.mjs`                   |
| A skill added/renamed/rescoped                           | set globs in `.claude/skill-globs.json` · `bun .claude/gen-skill-adapters.mjs` (Cursor/Copilot) |

→ Full guide: [`definition-of-done`](.claude/skills/definition-of-done/SKILL.md), [`ship`](.claude/skills/ship/SKILL.md)

## Reuse and centralization

Agents reinvent components and utilities because they don't look first, and architecture drifts:
three near-identical buttons, four date formatters, a feature-local copy of a shared hook. Before you
create **any** component, hook, util, type, or validator:

1. **Search the design system first** — [`packages/ui`](packages/ui/) (Button, Input, Badge, Dialog, Skeletonize, …). A UI need almost always has a primitive already.
2. **Then shared code** — top-level `app/{components,hooks,actions,utils}/`; for backend, `convex/lib/` and `lib/shared/`.
3. **Then the feature** — a sibling in the feature's own folder to extend.
4. Only if nothing fits, **create — in its canonical home, once.**

- **Compose or extend, don't clone.** Never duplicate a primitive's role — add a `variant`/prop or compose it. A new shared primitive goes in `packages/ui` with a story, never a one-off in a feature folder.
- **Extract on the second use.** Copy-pasting a block a second time is the signal to lift it into the shared home.
- **Mirror the neighbours.** Before adding a sibling (domain query, route, locale file), open 1–2 existing ones and match structure, naming, and wrappers exactly.

→ Full guide: [`clean-code`](.claude/skills/clean-code/SKILL.md)

## Verification is mandatory

A change is not done because the code looks right — it is done when you have **observed the expected
outcome and can show the evidence**. Never claim a success you have not verified. Escalate to match
the change: static (`bun run check`) → unit → backend (run it on the live deployment via the **Convex
MCP**) → UI (drive the real app via the **Playwright MCP**) → codify the check as a rerunnable test.
Report outcome vs. expectation; if a layer couldn't be verified, say which and why.
→ Full guide: [`verify`](.claude/skills/verify/SKILL.md)

## Non-negotiable rules

These hold across every workspace and language. They are not style preferences.

- **Never destroy state without explicit permission.** Local databases, Convex state, caches, config files, branded seed data — ask before wiping. Assume every file on disk may be the user's in-progress work.
- **Never hardcode secrets or credentials.** Environment variables only. Scrub logs before committing.
- **Validate at every system boundary.** User input, external APIs, webhook payloads. Parameterized queries only; never string-concatenate SQL or shell.
- **Docs and translations ship with the code.** A user-visible change updates `docs/` in all three base locales and keeps every `en.json` key present in `de.json` and `fr.json` on the same commit. Variant files (`de-CH`) hold only overrides. **The agent instructions (`AGENTS.md`, `.claude/skills/`) are docs too** — when you change a path, command, or pattern they describe, update them in the same commit.
- **Accessibility is Level AA, not a nice-to-have.** Real HTML, keyboard reachability, visible focus, labelled controls, AA contrast.

## Rules are self-enforcing

Prefer a test to a sentence: most rules here are enforced by a guard, so trust the gate and run it.
i18n parity/usage/ICU (`packages/ui/src/i18n/tests/`, each service's `messages.test.ts`) · docs
structure/locale/nav (`services/docs/tests/`) · skeleton conventions (platform
`skeleton-conventions.test.ts`) · a11y (`checkAccessibility()` + `vitest-axe`, Storybook
`addon-a11y`) · migrations (`migrations:check`) · SAST ([`tools/opengrep/`](tools/opengrep/)) ·
oxlint (`.oxlintrc.json`: `no-explicit-any`, jsx-a11y, hooks) · commitlint (`.commitlintrc.json`) ·
knip · strict typecheck. **When you add a rule, add the guard.**

## Code style

- **Filenames:** dash-case everywhere except Convex, which uses snake_case.
- **No status comments** (`// REFACTORED`, `// TODO: see #123`) and no comments narrating removed code. Git is the record. Comments explain _why_, rarely _what_.
- **No empty catch blocks.** Log (`console.warn`/`console.error`) or re-throw. Silent catches hide bugs.
- **No locale-aware date methods.** `toLocaleDateString`/`toLocaleTimeString`/`toLocaleString` are banned. Use `useFormatDate()` in React or `formatDate()` from [`lib/utils/date/format`](services/platform/lib/utils/date/format.ts).
- **No `\uXXXX` escapes in JSON.** Write non-ASCII literally as UTF-8 (`ät`, `é`, `—`, `«»`). JSON's required escapes (`\n`, `\t`, `\"`, `\\`) stay.

→ Full guide: [`clean-code`](.claude/skills/clean-code/SKILL.md)

## Security

Security is a first pass, not a clean-up step. On every change, check the OWASP top 10 where they
apply: command injection, XSS, SQL injection, SSRF, auth bypass, IDOR, deserialization. If you touch
a boundary (request handler, file system, shell), assume adversarial input and prove it is safe. A
strict SAST gate (Opengrep) blocks on any finding — runner and rules in [`tools/opengrep/`](tools/opengrep/),
run locally with `bun run lint:sast`. Suppress a genuine false-positive narrowly with `// nosemgrep:
<rule-id>` plus an adjacent comment explaining why — never a blanket ignore.
→ Full guide: [`security`](.claude/skills/security/SKILL.md)

## Git and commits

- **Scope and type:** see [`.commitlintrc.json`](.commitlintrc.json) for the allowed set (enforced by the `commit-msg` hook).
- **Header ≤72 characters,** lowercase description, no trailing period: `feat(platform): add arena mode`.
- **Atomic commits.** One logical change each. If the message needs "and", it's probably two commits.
- **Imperative mood.** `add X`, not `added`/`adds`. Body explains _why_; header states _what_.
- **Branch off `main`;** never commit straight to it. Stash or use a worktree to keep unrelated work apart.

→ Full guide: [`git`](.claude/skills/git/SKILL.md)

## Testing

- **Lock in behaviour before you change it.** Touching untested code? Write the test that captures current behaviour first, then change it.
- **Every feature and fix carries its test** — happy path, one edge, one error condition minimum.
- **A green suite is the only merge signal.** `bun run check` fans the `test` task across every workspace; while iterating, run the one you touched: `bun run --filter @tale/<workspace> test`.
- **Test homes:** co-located `*.test.{ts,tsx}` (the default) and a workspace-root `tests/` for what can't sit beside source (`e2e/` Playwright `*.spec.ts`, `integration/` `*-test.ts`, `manual/`, `stress/`). No `__tests__/` dirs.

→ Full guide: [`testing`](.claude/skills/testing/SKILL.md)

## TypeScript

- **Implicit typing wins** where inference is obvious; annotate public APIs and anywhere the inferred type would confuse.
- **Never `as`, never `any`, never `unknown`** (enforced by oxlint). Use type guards, generics, discriminated unions, or `never`. Framework-generated code and rare third-party gaps are the only exceptions — document them in one line.
- **Named exports only;** default exports resist renaming and break grep. **Avoid barrel files.** Imports at the top, exports at the bottom.
- **Validate at boundaries with Zod;** shared schemas in `services/platform/lib/shared/schemas/`, imported on both client and server.

→ Full guide: [`typescript`](.claude/skills/typescript/SKILL.md)

## React and TanStack Start

- **`app/`** holds route-scoped code; top-level `components/`/`hooks/`/`actions/`/`utils/` hold cross-route shared code.
- **Navigation** uses TanStack Router (`useNavigate()`, `<Link>`). No `window.location`.
- **Images** go through the `Image` component (`@/components/ui/image`); never bare `<img>`.
- **No hardcoded user-facing strings** — always the `useT()` hook. A stray English literal in JSX is a bug.
- **Loading is centralized** — split into presentational + container, wrap the plain part in `<Skeletonize loading>` ([`@tale/ui/skeleton-context`](packages/ui/src/components/feedback/skeleton-context.tsx)); skeleton-aware leaves mask to their own size. Never the bare `<Skeleton>` or a magic `h-[…]`.
- **CVA for named variants** (`variant`/`size`/`tone`); a conditional `cn()` for boolean states. Reach for `useMemo`/`memo` only when the profile justifies it, and avoid the `useEffect` reflex.

→ Full guide: [`react`](.claude/skills/react/SKILL.md), [`ui-components`](.claude/skills/ui-components/SKILL.md)

## Convex

- **No `.collect()`** — iterate with `for await` or `.paginate()`. **Use `queryWithRLS`/`mutationWithRLS`**, not raw `query`/`mutation`. **Backend returns raw data;** the client filters/sorts/paginates.
- **Validate `args` and declare `returns`** with `convex/values`; shared shapes in `convex/lib/validators/`.
- **Prefer `getAuthUserIdentity`** (0 DB) over `getAuthUser` (2 DB) in read queries. **Delete deprecated functions** — no tombstones.
- **Never `import 'node:*'` in V8 code** — load file I/O in a `'use node'` module and pass data in.

→ Full guide: [`convex`](.claude/skills/convex/SKILL.md), [`convex-migrations`](.claude/skills/convex-migrations/SKILL.md)

## Databases and migrations

Two Postgres databases back the stack: `tale` (the `db` service, app/auth; Convex owns its schema)
and `tale_knowledge` (the `knowledge-db` service, ParadeDB — RAG + crawler corpus). Knowledge-DB
migrations live under [`services/db/migrations/`](services/db/migrations/), grouped per container and
applied by `docker-entrypoint.sh` per the `TALE_DB_ROLE` env var. Timestamped, idempotent, with
`-- migrate:up`/`-- migrate:down`. **A schema change ships its migration in the same PR and you verify
a clean `docker compose up` leaves both knowledge schemas populated** — orphaned migrations fail every
query with `undefined_table`.
→ Full guide: [`docker`](.claude/skills/docker/SKILL.md), [`convex-migrations`](.claude/skills/convex-migrations/SKILL.md)

## Internationalization

Every user-facing string goes through the translation layer; never compare against an English literal
in code, tests, or stories. **`en.json` is the schema** — every key exists in `de.json` and `fr.json`
on the same commit; `de-CH` carries only differing values (fallback `de-CH → de → en`). Remove dead
keys everywhere (orphan-key test). Sentence case; **informal form** (`du`, `tu` — never `Sie`/`vous`);
ICU placeholders copy exactly; brand names don't translate. `useT(namespace)` from
[`lib/i18n/client`](services/platform/lib/i18n/client.tsx).
→ Full guide: [`translation`](.claude/skills/translation/SKILL.md)

## Documentation

Docs are not a follow-up. Every change a user would notice updates `docs/` in every base locale in the
same PR, with a real opening (≥2 sentences of prose) and a real closing (a recap, not a `## Next`
stub). Before a PR touching `services/docs/`, run its `lint` / `test` / `build`
(`bun run --filter @tale/docs test`); formatting is handled repo-wide by `oxfmt` (and the edit hook).
→ Full guide: [`docs`](.claude/skills/docs/SKILL.md), [`docs-check`](.claude/skills/docs-check/SKILL.md)

## Accessibility

Everything Tale ships meets [WCAG 2.1 AA](https://www.w3.org/TR/WCAG21/) — mandatory, not aspirational.
Real HTML elements (`<div onClick>` is not a button); one `<main>` and one `<h1>` per page, no skipped
heading levels; every image has `alt`, every icon-only button a translated `aria-label`; everything
interactive is keyboard-reachable with a visible ≥3:1 focus ring and a ≥24×24px target; form errors
say what and how, wired via `aria-describedby`/`aria-invalid`/`role="alert"`; text contrast ≥4.5:1;
respect `prefers-reduced-motion`. Every component has an `accessibility` describe block calling
`checkAccessibility()`; a red bar in Storybook's a11y addon is a blocker.
→ Full guide: [`ui-components`](.claude/skills/ui-components/SKILL.md)

## Anti-patterns — you'll be tempted to X; don't

| Tempted to…                            | Instead                                    | Caught by                      |
| -------------------------------------- | ------------------------------------------ | ------------------------------ |
| Update `en.json` only                  | all base locales + variants, same commit   | i18n parity test · Ripple Map  |
| Add a Convex field, skip the migration | versioned reversible migration + test      | `migrations:check` · DoD       |
| Hand-roll a skeleton (`h-[200px]`)     | `<Skeletonize>` + skeleton-aware leaves    | `skeleton-conventions.test.ts` |
| Build a new Button/Input/Badge         | reuse/extend the `packages/ui` primitive   | reuse discipline · review      |
| `as any` to silence TS                 | type guard / generic / discriminated union | oxlint `no-explicit-any`       |
| Bare `<img>`                           | the `Image` component                      | oxlint jsx-a11y `alt-text`     |
| `toLocaleDateString`                   | `useFormatDate()`                          | code style · review            |
| `.collect()` on a large set            | `for await` / `.paginate()`                | `convex` guide · review        |
| `window.location` for nav              | `useNavigate`/`<Link>`                     | `react` guide                  |
| `useEffect` for derived state          | derive in render / event handler           | `react` guide                  |
| Empty catch                            | log or re-throw                            | code style                     |
| Declare "done" unrun                   | observe the outcome, show evidence         | verification doctrine          |

## Skills and guides index

Load the relevant guide before working in an area. Adding or removing a skill updates this table (it
is the map every agent reads). Skills live in [`.claude/skills/`](.claude/skills/); authoring standard
in [`SKILL_TEMPLATE.md`](.claude/skills/SKILL_TEMPLATE.md).

**Cross-tool auto-attach.** A `SKILL.md` is the single source of truth, surfaced four ways: Claude Code
loads it natively; Cursor and Copilot pull it in by file context via generated pointers
([`.cursor/rules/<skill>.mdc`](.cursor/rules/) with `globs:`, [`.github/instructions/<skill>.instructions.md`](.github/instructions/)
with `applyTo:`); Codex/Gemini reach it through this index. The pointers are **generated** — never edit
them by hand. After adding/renaming a skill or changing its scope, set its file globs in
[`.claude/skill-globs.json`](.claude/skill-globs.json) (empty array = activity-scoped, no auto-attach)
and run `bun .claude/gen-skill-adapters.mjs`. `bun .claude/check-skill-links.mjs` fails if the globs
file or the generated adapters are out of sync.

**Working method** — read before planning or finishing work:
| Skill | Read before… |
|---|---|
| [`engineering-approach`](.claude/skills/engineering-approach/SKILL.md) | starting any non-trivial task — classify, think, self-review |
| [`plan`](.claude/skills/plan/SKILL.md) | planning a multi-step change |
| [`definition-of-done`](.claude/skills/definition-of-done/SKILL.md) | deciding whether a change is complete |
| [`verify`](.claude/skills/verify/SKILL.md) | confirming a change works (the `/verify` command) |
| [`review`](.claude/skills/review/SKILL.md) | reviewing a diff or PR |
| [`ship`](.claude/skills/ship/SKILL.md) | opening a PR (the `/ship` command) |
| [`debug`](.claude/skills/debug/SKILL.md) | chasing a bug to root cause |
| [`handoff`](.claude/skills/handoff/SKILL.md) | persisting learnings / continuing a long task |
| [`write-skill`](.claude/skills/write-skill/SKILL.md) | adding or editing a skill |

**Languages & frameworks** — read before writing code in that area:
| Skill | Read before… |
|---|---|
| [`clean-code`](.claude/skills/clean-code/SKILL.md) | writing any code — naming, functions, reuse, errors |
| [`typescript`](.claude/skills/typescript/SKILL.md) | TypeScript types, Zod, exports |
| [`react`](.claude/skills/react/SKILL.md) | React + TanStack Router/Query, hooks, data fetching |
| [`ui-components`](.claude/skills/ui-components/SKILL.md) | UI primitives — Radix, CVA, Tailwind, Storybook, a11y |
| [`convex`](.claude/skills/convex/SKILL.md) | Convex queries/mutations/actions, RLS, Hono routes |
| [`convex-migrations`](.claude/skills/convex-migrations/SKILL.md) | a Convex data-model change |
| [`docker`](.claude/skills/docker/SKILL.md) | the local stack, compose, Dockerfiles, Postgres/dbmate |
| [`testing`](.claude/skills/testing/SKILL.md) | Vitest, Testing Library, Playwright e2e |
| [`performance`](.claude/skills/performance/SKILL.md) | cold-load, per-query cost, prompt-cache, prefetch |
| [`security`](.claude/skills/security/SKILL.md) | a boundary, secrets, SSRF, the SAST gate |
| [`git`](.claude/skills/git/SKILL.md) | commits, branching, stash vs worktree, rebase |
| [`python`](.claude/skills/python/SKILL.md) | editing a `.py` file (the pptx skill scripts under `examples/*/skills/pptx/`) |
| [`bash`](.claude/skills/bash/SKILL.md) | shell scripts and Docker entrypoints |

**Domain** — read before that specific work:
| Skill | Read before… |
|---|---|
| [`docs`](.claude/skills/docs/SKILL.md) | writing or editing a docs page |
| [`docs-check`](.claude/skills/docs-check/SKILL.md) | running the docs test suite / fixing its failures |
| [`translation`](.claude/skills/translation/SKILL.md) | editing any non-English locale file or doc |
| [`browser-qa`](.claude/skills/browser-qa/SKILL.md) | manual QA in a real browser (the `/qa` command) |
| [`auth-schema`](.claude/skills/auth-schema/SKILL.md) | regenerating the Better Auth schema for Convex |

Built-in harness skills cover the rest — `react-doctor`, `code-review`, `claude-api`, `deep-research`,
`update-config`. Don't reimplement them; the custom skills above add Tale-specific value.
