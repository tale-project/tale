---
name: plan
description: How to plan a multi-step change before writing code — explore reuse-first, decompose into vertical slices, decide a verification strategy, and only then implement. Read before starting any non-trivial or multi-file task, a refactor, or anything where the scope is uncertain. Classify the task first with engineering-approach; trivial single-file changes in a place you already know don't need a plan.
---

# plan

How to scope a multi-step change before the first edit: explore, design the smallest reversible
approach, slice it, and decide how each slice proves itself. Classify the task first with
[`engineering-approach`](../engineering-approach/SKILL.md); the verification layers live in
[`verify`](../verify/SKILL.md).

## When this applies

Plan when the scope is uncertain, multiple areas are involved, or the change is hard to reverse — a
refactor, a feature, a migration, anything multi-file. Skip the ceremony for a typo, a one-line fix,
or a change isolated to a file you already know; a formal plan for a trivial change is noise.

## The rules

- **Restate the intent and surface ambiguity now** — before any build, not after a wrong one. A wrong
  premise wastes every slice that follows. `reviewer-caught`.
- **Explore reuse-first before designing anything new.** Search `packages/ui`, then shared
  `app/`/`lib/`, then the feature (the discovery procedure in
  [`clean-code`](../clean-code/SKILL.md)) — new code that duplicates existing code is a defect.
  `reviewer-caught`.
- **Pick the smallest correct, most reversible approach, and name the Ripple Map fallout.** List the
  files you'll touch plus the cross-cutting work the Ripple Map in [`/AGENTS.md`](../../../AGENTS.md)
  pulls in (translations in all locales, docs, migration, tests, a11y) — that fallout is what gets
  forgotten. `reviewer-caught`.
- **Decompose into vertical slices, not horizontal layers.** Each slice is a thin end-to-end change
  that stays green and is independently committable — never "all the backend, then all the frontend,"
  which can't be verified or reverted until the end. `reviewer-caught`.
- **Decide how you'll verify each slice before writing it** — which layer of
  [`verify`](../verify/SKILL.md) applies. A slice isn't planned until you know how you'll prove it
  works; otherwise "done" is a guess. `reviewer-caught`.
- **Write the plan down for a substantial change** — an ordered list of slices + the Ripple Map + the
  verification strategy — so it survives context compaction and a reviewer can follow it. Keep it
  lean: a plan longer than the change isn't a plan. `reviewer-caught`.

## Patterns

- **Parallel exploration on Claude Code** — for broad scope, fan out read-only `Explore`/`Plan`
  subagents in parallel and keep their conclusions, not the file dumps. The conclusion is the
  artifact; the file contents are not.
- **Optional TDD per slice** — lock the slice's behaviour with a failing test first, then make it
  pass. The test doubles as the slice's verification strategy.
