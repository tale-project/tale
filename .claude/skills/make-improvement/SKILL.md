---
name: make-improvement
description: Use this skill whenever you change existing code WITHOUT changing its behaviour — refactor, optimize, simplify, deduplicate, rename, restructure, extract, or pay down tech debt. It keeps you green while you move and locks behaviour with tests first. Load it the moment a task says "clean up", "refactor", "simplify", "make faster", "extract", "consolidate", or "merge", or whenever you're tempted to rewrite working code. Never refactor without it. If the change adds behaviour use implement-feature; if it fixes a defect use fix-bug.
---

# make-improvement

Change the **structure, not the behaviour**. The entire discipline is staying green while you move:
an "improvement" that quietly changes what the code does is a bug you shipped on purpose. The thing
you're improving almost always **is** an existing concept, so Gate A here is mostly _find it and lock
it down_. For new behaviour use `implement-feature`; for a defect use `fix-bug`; to open the PR,
`create-pr`.

## When this applies

Refactors, performance work, readability cleanups, renames, extracting or consolidating shared code,
and tech-debt paydown — any change whose success is defined by "behaves exactly the same, but better".

## Write a note first

**Invoke `write-notes`** and answer this form before you change anything:

- **Goal:** Describe what will improve (structure / performance / clarity) and the exact behaviour that must stay identical.
- **Current shape:** Walk through how the code works today — trace the path you'll restructure and name its callers.
- **The concept:** Describe the duplication you're collapsing or the primitive you're extracting, and where the single canonical version will live.
- **Safety net:** Describe how you've pinned today's behaviour — which test covers it, or the characterization test you wrote and watched pass first.
- **Baseline:** For a performance change, describe what you measured and the number you'll compare against.
- **Risks & unknowns:** What behaviour might you change by accident? Describe where you're least confident and how you'd notice a regression.

## Gate A — before you write code

**Tick every box, or N/A with a reason — an unticked box means not done.**

- [ ] **Note** — the form above is answered and written first (`write-notes`).
- [ ] **Intent** — the goal is structure / performance / clarity, **explicitly not** new behaviour;
      if "improve" hides a feature or a fix, split it into its own change and commit.
- [ ] **Status quo** — you know exactly what the code does today, and for a performance change you
      **baselined it first**: no speedup claim without a before-number.
- [ ] **Reuse** — the concept you're consolidating INTO is found (`search-codebase`) — improving
      turns two divergent copies into one canonical one, never adds a third (the doctrine:
      `implement-feature`).
- [ ] **Conventions** — discovered from the tooling and the neighbours (`search-codebase` orient),
      so the improved code still matches the project and passes its gate.
- [ ] **Blast radius** — every caller of what you're restructuring enumerated (`search-codebase`
      sweep).
- [ ] **Behaviour locked** — a passing test pins today's behaviour; if the code wasn't covered, you
      wrote the characterization test and watched it pass first — your safety net for every step.

## Do the work in reversible steps

- **Small steps, green throughout.** Move in increments that each keep the suite passing; commit each
  coherent step so any one is trivially revertible.
- **Never fold in a feature or a fix.** Spot a bug mid-refactor? Note it and handle it separately — a
  mixed commit is impossible to review or revert cleanly.
- **For performance: one change, re-measure, keep what the numbers justify.** Don't stack speculative
  optimizations; prove each.

## Gate B — before you call it done

**Tick every box, or N/A with a reason — an unticked box means not done.**

- [ ] **Unchanged** — the locking tests still pass, untouched.
- [ ] **Numbers** — performance claims backed by before/after measurements, not vibes (or N/A).
- [ ] **Duplication gone** — the reuse is achieved, not relocated; docs and comments that described
      the old structure are updated.
- [ ] **Definition of done** — walk `create-pr`'s shared checklist now, not at PR time.
- [ ] **Sweep** — every caller enumerated at Gate A is checked or explicitly ruled out
      (`search-codebase`).
- [ ] **Observed** — the real outcome watched (`test-code`), never a green typecheck alone.

Then take it to a clean PR with `create-pr`.

## Patterns

- **Refactor or feature — never both in one commit.** The mix is the single most common way a
  "harmless cleanup" ships a regression.
- **Make it work, make it right, make it fast — in that order**, proving each with the suite before
  the next.
