---
description: Run the pre-PR Definition of Done and open a clean PR
argument-hint: [optional PR title]
allowed-tools: Read, Bash, Skill
---

Take the current change from "code written" to "ready to merge". Follow the
[`ship`](../skills/ship/SKILL.md) skill and do not skip a box.

1. **Walk the Ripple Map** (see `/AGENTS.md`): a change is rarely one file. Confirm translations in
   all base locales, docs in all base locales, migrations, tests, a11y, and Storybook are all done
   or explicitly N/A.
2. **Self-review the diff** as a skeptical senior reviewer — correctness, edge cases, security,
   reuse, simplicity, convention-match.
3. **Run the gate:** `bun run check` (format, lint, typecheck, tests). Then `bun run lint:sast`,
   `bun run migrations:check` (if a data model changed), and `bun run test:e2e` for any touched
   frontend service.
4. **Verify behaviour** — run `/verify` for anything a user can see or call.
5. **Review** — run the [`review`](../skills/review/SKILL.md) skill (CodeRabbit + self-review) and
   address findings.
6. **Commit & PR** — atomic commits, conventional scope/type (see `commitlint.config.mjs`),
   imperative ≤72-char header. Paste the Definition-of-Done checklist into the PR body with every box
   ticked or marked N/A. No `Co-Authored-By`, no generated-attribution lines.
