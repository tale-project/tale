---
name: delegate-work
description: "Use this skill whenever a task is big enough to split across subagents — several independent deliverables, the same mechanical change across many files or call sites, or research questions that can run in parallel. It owns the delegation discipline: decide split vs solo, cut the work into self-contained units with explicit file boundaries, write each subagent a complete brief (goal, scope in and out, context it can't discover itself, expected return format), never let two agents edit the same file, review every returned result like a stranger's diff, and integrate and verify the merged whole yourself — the delegator owns the done-gate. Load it when a task lists multiple independent deliverables, when a search-codebase sweep returns many disjoint sites, or when you're about to repeat the same edit many times. With no subagent capability, keep the decomposition and run the units sequentially. Never split deeply coupled work, and never ship a subagent's output unreviewed."
---

# delegate-work

Delegation multiplies you only when the cut is clean — a bad split costs more than doing it solo.
Subagents produce inputs; **the delegator owns the merged change and its done-gate** — that never
delegates. To find the disjoint sites worth splitting over, `search-codebase`; to research angles
in parallel, `deep-research`.

## When this applies

A task lists several independent deliverables; a `search-codebase` sweep returns many disjoint
sites (more than ~5 similar edits); research questions can run in parallel. First check whether
your harness has a subagent capability at all — if not, skip to "No subagents available".

## Write a note first

**Invoke `write-notes`** and answer this form before you spawn anything:

- **Split or solo:** Describe why this task splits — or doesn't (see the tests below).
- **Units:** List each unit with its goal and its file/directory boundary.
- **Seams:** Name what the units share (types, schemas, APIs) and how you'll fix each seam first.
- **Verification:** Describe how you'll verify the merged whole, not just each unit.

## Split vs stay solo

**Split** when units are independent and self-contained, touch disjoint files, and none depends on
another's in-flight output — the same mechanical change across many sites, parallel research
angles, separable deliverables.

**Stay solo** when units share files or in-flight state; when each step's design depends on the
previous step's outcome; when the task is smaller than the cost of briefing; or when you can't
write a self-contained brief for a unit — that inability is the signal that the cut is wrong.

## Decompose with hard boundaries

- A unit is **one goal + an explicit file/directory boundary + no dependency on another unit's
  in-flight output**.
- Boundaries are disjoint by construction: **never let two agents edit the same file.** A conflict
  between agents is unreviewable.
- If units meet at a seam — a shared type, schema, or API — **you change the seam first**, then
  delegate the sides against the fixed seam.

## The brief — what a subagent gets

- **Goal** — one sentence of outcome, not steps.
- **Scope** — IN: the files or area it owns. OUT: the tempting adjacents it must not touch, by
  name.
- **Context it can't discover** — decisions already made, conventions you learned orienting
  (`search-codebase`), why the task exists, the relevant slice of your note.
- **Discipline** — which workflow skill applies to its unit (`fix-bug`, `implement-feature`, …).
- **Expected return** — files changed, what it verified and how, and open questions. Never "done"
  alone.

## Integrate and verify — you, not them

- Read every returned diff as a stranger's PR (`review-code`).
- Reconcile the seams yourself; don't ask an agent to merge another agent's work.
- Re-run the sweep over the merged result (`search-codebase`) — units can each be right and the
  whole still be incomplete.
- Run the full gate and observe the real outcome (`test-code`) on the whole, not per-unit. A
  subagent saying "done" is a claim, not evidence.

## No subagents available

Keep the decomposition, drop the parallelism: run the units yourself, sequentially, in dependency
order — the briefs become your own checklist. Don't simulate parallelism by interleaving half-done
units. The discipline is the decomposition, not the parallelism.

## Before you call the delegated work done

- [ ] The split is justified — units independent, boundaries disjoint — or solo was chosen with a reason.
- [ ] Every brief carried goal, scope in/out, non-discoverable context, and an expected return format.
- [ ] No two units touched the same file; seams were fixed by you before delegating.
- [ ] Every returned result was reviewed like a stranger's diff.
- [ ] The merged whole passed the full gate and you observed the real outcome yourself.
- [ ] The sweep was re-run over the merged result.
