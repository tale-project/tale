---
name: handoff
description: How to persist durable learnings and compress context for a long or multi-session task, so work survives a context boundary or a handoff to another agent. Read during long iterative work, when nearing a context limit, or when you discover a non-obvious fact worth remembering. Don't re-record what the repo or git already captures.
---

# handoff

Keep the _decisions and the non-obvious facts_ across a context boundary or an agent handoff — not a
transcript. Two distinct moves: persist a durable learning to memory (outlives this task), and write
a continuation note (re-orients the next agent on this task).

## When this applies

During long iterative work, when nearing a context limit, when handing to another agent, or the
moment you discover a non-obvious fact future work will need.

## The rules

**Persist durable learnings to memory.** When you learn a gotcha, a confirmed approach, or a
constraint that isn't in the code, write it to project memory rather than letting it evaporate. One
fact per file; a one-line pointer per fact goes in `MEMORY.md` (the index loaded each session).

- **Save** what isn't derivable from the code/git: why a decision was made, a constraint, a confirmed fix approach, a sharp gotcha. Convert relative dates to absolute — "last week" rots.
- **Don't save** what the repo already records — code structure, past fixes, file locations, anything already in `AGENTS.md`. If asked to "remember" one of those, capture what was _non-obvious_ about it instead.
- **Update, don't duplicate** — if a fact already has a file, edit it. Delete memories that turn out wrong; a stale memory misleads worse than a missing one.
- **Treat a recalled memory as true _when written_** — verify a named file/flag still exists before acting on it.

**Compress context for continuation.** Nearing a context limit or handing off, write a short note —
tight enough to re-orient in under a minute:

- **Goal & current status** — what's done, in progress, left.
- **Key decisions & why** — the forks already resolved, so they aren't relitigated.
- **Open questions / blockers** and the next concrete step.
- **Pointers** — the files, branches, and PRs in play (paths, not contents).

## Patterns

The plan file and the Definition of Done are your scaffolding — reference them, don't restate them.
A continuation note that re-derives what `git log` or the plan already says is wasted context; point
at it instead.
