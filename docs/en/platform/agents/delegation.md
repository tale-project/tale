---
title: Agent workers
description: An agent can spawn a focused worker for one task through the spawn_agent tool. This page hands you the mental model for when to spawn, how capabilities stay bounded, and what the job card shows.
---

Spawning is the move you make when one task deserves its own focused context: open-ended research, bulk extraction, drafting a long document. The agent you chat with composes a **worker** on demand — a name, task instructions, an optional operating method, and a tool grant — runs it, and folds the result back into its reply. Workers are ephemeral: they exist for one job, and their run is recorded as a **job card** in the chat.

This page hands you the mental model for when a worker is the right shape and how the platform keeps it bounded. The end-to-end walk lives in [Hand work to a worker](/tutorials/editor/delegate-between-agents).

## How a job runs

When the agent calls **spawn_agent**, Tale resolves the worker's capabilities, starts a fresh child conversation, and runs the worker non-interactively: it sees only the task input the agent sent (not the whole chat history), tracks its progress on a live checklist, and its final message comes back to the agent as the result. The chat shows a job card with the worker's name, live progress, terminal status, and an expandable transcript of everything it did.

Workers cannot talk to the user. If a worker needs input only a human can give, it says so in its result and the agent asks you — questions always come from the agent you actually talk to.

## Capabilities are a subset, always

A worker can hold at most what its spawning agent holds. Three layers decide the effective grant:

- **Org configuration** — the agent's own tools, skills, and integrations, as configured by your admins. Nothing new to manage per worker.
- **The per-job grant** — the agent picks the smallest set from its own capabilities for this task (fewer tools = a more focused worker).
- **Platform exceptions** — a few tools never transfer, most importantly the ask-the-user tool: a worker's questions must flow through the agent, so answering never dead-ends. Workers also cannot spawn workers. One exception runs the other way: every worker can always list and read the thread's files (uploads, generated outputs) — writing files or running code stays an explicit grant.

Anything requested outside those bounds is silently skipped and reported — the job card shows what was narrowed away, and the agent adapts (for example, telling you an integration needs connecting).

## Operating methods

For open-ended work, the agent can grant a **methodology skill** as the worker's operating method — `web-research` ships built-in: live planning on the checklist, per-question search budgets, and a cited deliverable. Methodologies are skills, so admins govern them the same way as every other skill.

## Limits and spend

A worker runs inside the turn that spawned it and cannot outlive it; when the ceiling is reached the job ends with its partial progress still visible on the card. That ceiling belongs to whatever host is running the turn rather than to the agent, which carries no deadline of its own. Token spend rolls up to the spawning agent, and spend limits are enforced for the organization as a whole rather than per agent, so a job's cost lands with the rest of the organization's usage. Admins cap how many jobs may run at once under **Governance → agent_jobs** (default 10).

## When to reach for it

| Use … when                                              | Worker | Single agent | Workflow |
| ------------------------------------------------------- | ------ | ------------ | -------- |
| One sub-task benefits from an isolated, focused context | ✓      |              |          |
| The agent can answer well inline                        |        | ✓            |          |
| Work has explicit stages with approvals between them    |        |              | ✓        |

The cost of a worker is one extra run; the benefit is a clean context with exactly the right capabilities for the sub-task, and a job card that shows the user what happened. When the stages are fixed and you want approvals or scheduling between them, a workflow is the right shape instead.
