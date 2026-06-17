# Tale — Copilot instructions

The canonical contract for working in this repository is [`AGENTS.md`](../AGENTS.md) at the repo
root. Read it and follow it. It defines how to work, the Definition of Done, the Ripple Map
("change X → also touch Y"), the mandatory verification doctrine, and the coding standards for every
language and framework in the monorepo, plus an index of deep guides under `.claude/skills/`.

Non-negotiable reflexes (full rules in `AGENTS.md`):

- **Reuse before you write** — search `packages/ui`, then shared `app/`/`lib/`, then the feature;
  extend existing primitives, never fork them.
- **A change is rarely one file** — translations in all base locales, docs with code, a migration for
  any data-model change, WCAG 2.1 AA for UI, and a test for every change.
- **Verify by observing the real outcome**, not by inspection. Never claim a success you haven't seen.
- **Think before acting** — classify the task, weigh impact, prefer the smallest correct, most
  reversible change.
