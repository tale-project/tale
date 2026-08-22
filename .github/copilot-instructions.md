# Tale — Copilot instructions

The canonical contract for working in this repository is [`AGENTS.md`](../AGENTS.md) at the repo
root — the shared tale-project contract — followed by [`.agents/repo.md`](../.agents/repo.md), the
repo-specific contract (layout, domain rules, skills index, debt ledger). Read both and follow
them.

Non-negotiable reflexes (full rules in the two contracts):

- **Reuse before you write** — search `packages/ui`, then shared `app/`/`lib/`, then the feature;
  extend existing primitives, never fork them.
- **A change is rarely one file** — translations in all base locales, docs with code, a migration
  for any data-model change, WCAG 2.1 AA for UI, and a test for every change.
- **Verify by observing the real outcome**, not by inspection. Never claim a success you haven't
  seen.
- **Think before acting** — classify the task, weigh impact, prefer the smallest correct, most
  reversible change.
