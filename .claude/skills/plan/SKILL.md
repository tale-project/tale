---
name: plan
description: How to plan a multi-step change before writing code — explore (reuse-first), decompose into vertical slices, decide a verification strategy, and only then implement. Read before starting any non-trivial or multi-file task, a refactor, or anything where you're unsure of the scope. Trivial, single-file, known-location changes don't need a formal plan — just do them.
---

# plan

Planning is cheap insurance against a wrong, expensive change. Plan when the scope is uncertain,
multiple areas are involved, or the change is hard to reverse. Skip the ceremony for a typo, a
one-line fix, or a change isolated to a file you already know. First classify the task with
[`engineering-approach`](../engineering-approach/SKILL.md).

## The loop

1. **Understand** the request and the code around it. Restate the intent; surface ambiguity now, not after a wrong build.
2. **Explore — reuse-first.** Find what already exists before designing anything new: search [`packages/ui`](../../../packages/ui/), then shared `app/`/`lib/`, then the feature (the discovery procedure in [`clean-code`](../clean-code/SKILL.md)). On Claude Code, fan out read-only `Explore`/`Plan` subagents in parallel for broad scope and keep the conclusion, not the file dumps.
3. **Design.** Pick the smallest correct, most reversible approach. Name the files you'll touch and the Ripple Map fallout (translations, docs, migration, tests, a11y). Weigh one alternative.
4. **Decompose into vertical slices.** Each slice is a thin end-to-end change that stays green and is independently committable — not "all the backend, then all the frontend." Optionally TDD: lock behaviour with a test first.
5. **Decide how you'll verify** each slice before writing it (which layer of [`verify`](../verify/SKILL.md) applies). A slice isn't planned until you know how you'll prove it works.
6. **Execute** atomically, self-reviewing the plan first (see engineering-approach §3).

## Planning artifacts

For a substantial change, write the plan down (a short ordered list of slices + the Ripple Map +
the verification strategy) so it survives context compaction and a reviewer can follow it. Keep it
lean; a plan that's longer than the change isn't a plan.

## When NOT to plan

A formal plan for a trivial change is noise. If you can hold the whole change in your head and it's
one file in a place you know, write it and verify it. Reserve planning for real uncertainty.
