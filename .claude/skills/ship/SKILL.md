---
name: ship
description: The pre-PR routine — take a change from "code written" to "ready to merge". Read before opening a PR or when running the /ship command. Walks the Definition of Done and Ripple Map, runs the full gate, verifies behaviour, runs review, and opens a clean conventional-commit PR. Don't skip a box.
---

# ship

The last mile: turn a finished change into a mergeable PR without leaving cross-cutting work undone.
It composes the other workflow skills — don't duplicate their detail, run them. Backs the `/ship`
command.

## When this applies

Before opening any PR, and when `/ship` runs. By this point the code is written; ship is the routine
that proves it's actually done.

## The rules

Run the routine in order; each step gates the next.

1. **Walk the Ripple Map and Definition of Done** ([`definition-of-done`](../definition-of-done/SKILL.md)). Confirm translations (all base locales), docs (all base locales), migrations, tests, a11y, and Storybook are each done or explicitly N/A in the commit body.
2. **Self-review and review** ([`review`](../review/SKILL.md)) — your own diff first, then CodeRabbit / code-review / security-review. Address findings.
3. **Run the gate** — a green gate is necessary, not sufficient:
   - `bun run check` — format, lint, typecheck, all tests.
   - `bun run lint:sast` — Opengrep (required CI gate).
   - `bun run --filter @tale/platform migrations:check` — if a Convex data model changed.
   - `bun run test:e2e` — for any touched frontend service (`platform`/`web`/`docs`).
4. **Verify behaviour** ([`verify`](../verify/SKILL.md)) — run `/verify` for anything a user can see or call.
5. **Commit & PR** ([`git`](../git/SKILL.md)):
   - Atomic commits; conventional scope/type from [`.commitlintrc.json`](../../../.commitlintrc.json); imperative, lowercase, ≤72-char header.
   - Branch off `main`; never push straight to it.
   - **No `Co-Authored-By`, no "Generated with Claude Code" / attribution lines** (repo rule).
   - Paste the Definition-of-Done checklist into the PR body with every box ticked or marked N/A. Empty boxes get rejected.

## Patterns

Don't:

- Open the PR to "see if CI passes" in place of running the gate locally — that wastes CI and reviewer time.
- Bundle unrelated changes into one PR.
- Mark a box done you didn't do.
