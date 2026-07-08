---
title: Task automation
description: The default task-ops pack — how assigning a task to an agent runs it, the human review gate, guardrails (budgets, concurrency, circuit breakers), and the kill switch.
---

Assigning a board task to an AI agent puts it to work. The **task-ops pack** — eleven file-based workflows provisioned to every organization — covers the full lifecycle: triage, execution, review, escalation, SLA enforcement, and cleanup. Every workflow is a plain JSON file your organization owns: tune the thresholds, edit the prompts, or deactivate individual triggers on the workflow itself. A task an automation proposes sits in [Backlog](/platform/projects/backlog) until a human Starts it — from that moment on it's a board task like any other and enters the loop below.

## The execution loop

1. **Assign** a task to an agent (or let _unassigned triage_ score and route new tasks automatically — high-confidence matches auto-assign, the rest get a suggestion comment).
2. The agent **acknowledges** (task moves to _In progress_), works in its own task thread with the task tools, and posts its result as a comment.
3. The task parks at **_In review_** — agents can never set _Done_; that rule is enforced server-side regardless of any workflow configuration.
4. A human **approves** (the only automated path to _Done_) or **requests changes** with feedback, which re-engages the same agent on the shared thread and opens a fresh review gate. Reviews are answerable from the task sheet or directly from the Inbox.

Failures roll the task back to _To do_ with an explanatory comment. When a decomposed root task has subtasks, the parent waits until the last subtask closes, then rolls up to _In review_.

## Mentions, dependencies, deadlines

- **@-mention an agent** in a task comment or in the task description and it reads the mentioning text and acts. Typing `@` opens an autocomplete over members and the project's agents; the composer previews whether each mentioned agent will actually respond (automation off, budget exhausted, paused). Editing a description triggers only newly added mentions, and anything the automation writes itself never triggers anyone.
- When a **blocker closes**, dependent tasks get a remaining-blocker note; fully unblocked agent work restarts automatically, human work gets an inbox notification.
- **Due dates** drive an SLA ladder: a 24h warning, an overdue nudge, then a human escalation to the project creator and org admins — repeated once more if the task stays overdue. Each level fires at most once; pushing the due date out resets the ladder.

## Guardrails

Every agent run — assignment, mention, revision, escalation, external — passes the same admission gate:

- **Budgets** (per agent, monthly): at the warn threshold the agent gets an economy instruction and admins are notified once; at the pause threshold new runs are refused. Resets at month rollover.
- **Concurrency caps** (per agent and org-wide): excess runs queue and start automatically when a slot frees.
- **Per-task circuit breaker**: more than the configured runs per hour on one task pauses automation on that task until a human changes its status.

Org-wide caps (run concurrency, per-task runs per hour) ship as fixed platform defaults; per-agent budget and parallelism live in the agent's configuration.

## Choosing an assignee

Not every task belongs on a coding agent. Use this rule of thumb:

| Task shape                                                                 | Assign                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Research, writing, summaries, personal deliverables                        | A **person** — disable unassigned triage on personal projects so agents do not auto-pick them up                                                                                                                                       |
| General automation with platform tools (comments, workflows, integrations) | An **Agent** (platform tool loop)                                                                                                                                                                                                      |
| Repository work — bugs, features, refactors, PRs                           | A **Coding agent** with the right dispatch: tale-daemon (`runtime`) for git workspaces, durable sandbox when configured, or accept that sandbox-only coding agents still run the platform loop on the board until you add those fields |

The assignee picker groups **Agents** and **Coding agents** separately and shows a one-line dispatch hint for each coding agent. Image agents do not appear in the task assignee list.

## The kill switch

The `task_automation` governance policy carries the master switch: setting `enabled: false` in the org's `governance/task-automation.json` config file stops the run path — in-flight work finishes, nothing new starts. Admin-only, audited.
