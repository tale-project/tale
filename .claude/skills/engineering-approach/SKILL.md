---
name: engineering-approach
description: How to approach a coding task like a senior engineer — classify it (fix / refactor / feature / review / explore / migrate), think before acting, weigh impact, and self-review your plan and your diff. Read at the START of any non-trivial task, before you touch code, and whenever you're tempted to make a large or radical change. The biggest quality lever in this repo is deciding well, not typing fast.
---

# engineering-approach

You are an engineer, not a code-typer. Before you change anything, decide _how_ to approach the task —
the method differs by goal, and the cost of a wrong radical change dwarfs the cost of thinking first.
This skill is the working method that gates every other one ([`plan`](../plan/SKILL.md),
[`verify`](../verify/SKILL.md), [`review`](../review/SKILL.md),
[`definition-of-done`](../definition-of-done/SKILL.md)).

## 1. Classify the task — the method differs by goal

| Mode                       | Goal                                 | Discipline (and what to avoid)                                                                                                                                        |
| -------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fix** a bug              | Kill the root cause, not the symptom | Reproduce → write the failing regression test → **minimal** targeted fix → confirm green. Avoid scope creep and drive-by refactors. See [`debug`](../debug/SKILL.md). |
| **Refactor**               | Change structure, **not** behaviour  | Lock behaviour with tests first → small reversible steps → stay green throughout → never fold in a feature. Prefer incremental + reuse over a rewrite.                |
| **Implement** a feature    | New behaviour, fully integrated      | Understand intent → design → reuse-first → vertical slice → Definition of Done + Ripple Map → verify. Avoid gold-plating and speculative generality.                  |
| **Review**                 | Find what's wrong                    | Adversarial read (correctness/security/edge/reuse/simplicity); propose, don't silently rewrite. See [`review`](../review/SKILL.md).                                   |
| **Explore**                | Understand                           | Read-only, broad, return the conclusion. No edits.                                                                                                                    |
| **Migrate / large change** | Move safely at scale                 | Impact + dependents analysis first → phased, reversible → each phase green. Never a big-bang irreversible change.                                                     |

If the task is several of these, do them as separate steps (and separate commits) — don't blur a fix
into a refactor into a feature.

## 2. Think twice (pre-flight, before editing)

- **Restate the intent** in your own words. If it's ambiguous or has hidden forks, **ask** — don't guess.
- **Map the blast radius** (the Ripple Map in [`/AGENTS.md`](../../../AGENTS.md)) and the **dependents** — who imports or calls what you're about to change. Grep for callers.
- **Weigh at least one alternative.** Choose the **smallest correct, most reversible** change that fully solves the problem.
- **Name the risk and the rollback.** Never make a radical change without first understanding its impact. Additive/reversible beats destructive every time.
- **Confirm reuse** (the discovery procedure in [`clean-code`](../clean-code/SKILL.md)) before writing anything new.

## 3. Self-review — twice

- **Plan self-review** (before editing): is this the right altitude? The least-radical option? Consistent with how the repo already does it? Am I touching more than I should?
- **Diff self-review** (before "done"): re-read your own diff as a skeptical senior reviewer — correctness, edge cases, security, reuse, simplicity, convention-match, Ripple Map satisfied. Then run [`review`](../review/SKILL.md) and [`verify`](../verify/SKILL.md).

## 4. Know when to stop and ask

Irreversible or destructive operations, ambiguous intent, an architectural fork, or anything that
contradicts what you were told → **pause and surface it**. Asking a sharp question is senior
behaviour, not slow behaviour. Thinking is cheaper than undoing.
