---
name: handoff
description: How to persist durable learnings and compress context for a long or multi-session task, so work survives a context boundary or a handoff to another agent. Read during long iterative work, when nearing a context limit, or when you discover a non-obvious fact worth remembering. Don't re-record what the repo or git already captures.
---

# handoff

Long tasks lose state at context boundaries; multi-agent work loses it across agents. A good handoff
keeps the _decisions and the non-obvious facts_, not a transcript.

## Persist durable learnings (memory)

When you learn something non-obvious that future work will need — a gotcha, a confirmed approach, a
constraint that isn't in the code — write it to the project memory rather than letting it evaporate:

- The memory lives under the session memory dir with a one-line pointer per fact in `MEMORY.md` (the index loaded each session). One fact per file, with frontmatter (`type: user | feedback | project | reference`).
- **Save** what isn't derivable from the code/git: why a decision was made, a constraint, a confirmed fix approach, a sharp gotcha. Convert relative dates to absolute.
- **Don't save** what the repo already records — code structure, past fixes, file locations, things in `AGENTS.md`. If asked to "remember" one of those, capture what was _non-obvious_ about it instead.
- **Update, don't duplicate** — if a fact already has a file, edit it. Delete memories that turn out wrong.
- Treat recalled memories as background context that was true _when written_ — verify a named file/flag still exists before acting on it.

## Compress context for continuation

When a task is long and you're nearing a context limit (or handing to another agent), write a short
continuation note — not a transcript:

- **Goal & current status** — what's done, what's in progress, what's left.
- **Key decisions & why** — the forks already resolved, so they aren't relitigated.
- **Open questions / blockers** and the next concrete step.
- **Pointers** — the files, branches, and PRs in play (paths, not contents).

Keep it tight enough to re-orient in under a minute. The plan file and the Definition of Done are
your scaffolding — reference them rather than restating them.
