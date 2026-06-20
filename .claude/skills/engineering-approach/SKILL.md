---
name: engineering-approach
description: How to approach a coding task like a senior engineer — classify it (fix / refactor / feature / review / explore / migrate), map blast radius before editing, and self-review both your plan and your diff. Read at the START of any non-trivial task, before you touch code, and whenever you're tempted to make a large or radical change. The biggest quality lever in this repo is deciding well, not typing fast.
---

# engineering-approach

The working method that gates every other skill: classify the task, decide the approach, then act —
the discipline differs by goal, and a wrong radical change costs far more than thinking first.
Downstream method lives in [`plan`](../plan/SKILL.md), [`debug`](../debug/SKILL.md),
[`verify`](../verify/SKILL.md), [`review`](../review/SKILL.md), and
[`definition-of-done`](../definition-of-done/SKILL.md).

## When this applies

At the start of any non-trivial task — before the first edit — and again whenever you're about to
make a large, destructive, or hard-to-reverse change. Skip the ceremony only for a typo or a one-line
fix in a place you already know.

## The rules

- **Classify the task first; the discipline differs by goal** (table below). A wrong method — folding
  a fix into a refactor, rewriting where you should patch — is the most expensive mistake here.
  When a task is several modes, split it into separate steps and separate commits. `reviewer-caught`.
- **Restate the intent before editing.** If it's ambiguous or has hidden forks, ask — don't guess.
  Guessing the wrong intent wastes the whole change. `reviewer-caught`.
- **Map the blast radius and the dependents before editing.** Walk the Ripple Map in
  [`/AGENTS.md`](../../../AGENTS.md) (change X → also touch Y) and grep for callers/importers of what
  you're changing — Tale changes are rarely one file, and the cross-cutting work (translations,
  migrations, docs, a11y) is what gets forgotten. `reviewer-caught`.
- **Pick the smallest correct, most reversible change.** Weigh at least one alternative; additive
  beats destructive. Never make a radical change without first understanding its impact and naming the
  rollback. `reviewer-caught`.
- **Confirm reuse before writing anything new** — the discovery procedure in
  [`clean-code`](../clean-code/SKILL.md): search `packages/ui`, then shared `app/`/`lib/`, then the
  feature. New code that duplicates existing code is a defect, not a feature. `reviewer-caught`.
- **Self-review twice.** Before editing: is this the right altitude, the least-radical option,
  consistent with how the repo already does it? Before "done": re-read your own diff as a skeptical
  reviewer (correctness, edge cases, security, reuse, convention-match, Ripple Map satisfied), then
  run [`review`](../review/SKILL.md) and [`verify`](../verify/SKILL.md). `reviewer-caught`.
- **Stop and ask on a fork.** Irreversible/destructive operations, ambiguous intent, an architectural
  decision, or anything contradicting your instructions → pause and surface it before acting, not
  after. `reviewer-caught`.

## Patterns

Classify against this table, then follow that row's discipline:

| Mode                       | Goal                                 | Discipline (and what to avoid)                                                                                                                                    |
| -------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fix** a bug              | Kill the root cause, not the symptom | Reproduce → write the failing regression test → **minimal** targeted fix → confirm green. No scope creep, no drive-by refactor. See [`debug`](../debug/SKILL.md). |
| **Refactor**               | Change structure, **not** behaviour  | Lock behaviour with tests first → small reversible steps → stay green throughout → never fold in a feature. Prefer incremental + reuse over a rewrite.            |
| **Implement** a feature    | New behaviour, fully integrated      | Understand intent → design → reuse-first → vertical slice → Definition of Done + Ripple Map → verify. No gold-plating, no speculative generality.                 |
| **Review**                 | Find what's wrong                    | Adversarial read (correctness/security/edge/reuse/simplicity); propose, don't silently rewrite. See [`review`](../review/SKILL.md).                               |
| **Explore**                | Understand                           | Read-only, broad, return the conclusion. No edits.                                                                                                                |
| **Migrate / large change** | Move safely at scale                 | Impact + dependents analysis first → phased, reversible → each phase green. Never a big-bang irreversible change.                                                 |
