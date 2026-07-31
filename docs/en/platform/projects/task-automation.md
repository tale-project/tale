---
title: Task automation
description: The default task-ops pack — how assigning a task to an agent runs it, human review straight from the In review status, guardrails (budgets, concurrency, circuit breakers), and the kill switch.
---

Assigning a board task to an AI agent puts it to work. The **task-ops pack** — eleven file-based workflows provisioned to every organization — covers the full lifecycle: triage, execution, review, escalation, SLA enforcement, and cleanup. Every workflow is a plain JSON file your organization owns: tune the thresholds, edit the prompts, or deactivate individual triggers on the workflow itself. A task an automation proposes sits in [Backlog](/platform/projects/backlog) until a human Starts it — from that moment on it's a board task like any other and enters the loop below.

<Frame caption="The project task board — assigning a card to an agent is what starts the loop below.">

![A kanban task board inside the Website relaunch project, showing seven task cards spread across its status columns, from Backlog and To do through In review to Done and Cancelled.](/images/platform/projects-task-board.webp)

</Frame>

## The execution loop

1. **Assign** a task to an agent (or let _unassigned triage_ score and route new tasks automatically — high-confidence matches auto-assign, the rest get a suggestion comment).
2. The agent **acknowledges** (task moves to _In progress_), works in its own task thread with the task tools, and posts its result as a comment.
3. The task parks at **_In review_** — agents can never set _Done_; that rule is enforced server-side regardless of any workflow configuration.
4. A human **reviews from the _In review_ column** — the task sheet carries everything needed: the agent's report, the live run transcript behind each Activity badge, and the comments. Move the task to _Done_ to complete it, or send feedback by @-mentioning the assignee: a running agent picks the comment up mid-run, an idle one starts a rework run and parks the task back at _In review_. No approval card interrupts the flow — and no automation ever sets _Done_.

Failures roll the task back to _To do_ with an explanatory comment. When a decomposed root task has subtasks, the parent waits until the last subtask closes, then rolls up to _In review_.

## Mentions, dependencies, deadlines

- **@-mention an agent** in a task comment or in the task description and it reads the mentioning text and acts. Typing `@` opens an autocomplete over members and the project's agents; the chat previews whether each mentioned agent will actually respond (automation off, budget exhausted, paused). Editing a description or a comment triggers only newly added mentions, and anything the automation writes itself never triggers anyone. Mentions never move the board — with one exception: when the mentioned agent is the task's **assignee**, the mention is treated as a retry of its assigned work and follows the assignment choreography — _In progress_ while the admitted run works, _In review_ on success, rolled back to _To do_ with an explanatory comment on failure.
- When a **blocker closes**, dependent tasks get a remaining-blocker note; fully unblocked agent work restarts automatically, human work gets an inbox notification.
- **Due dates** drive an SLA ladder: a 24h warning, an overdue nudge, then a human escalation to the project creator and org admins — repeated once more if the task stays overdue. Each level fires at most once; pushing the due date out resets the ladder.

## Guardrails

Every agent run — assignment, mention, revision, escalation, external — passes the same admission gate:

- **Budgets** (per agent, monthly): at the warn threshold the agent gets an economy instruction and admins are notified once; at the pause threshold new runs are refused. Resets at month rollover.
- **Concurrency caps** (per agent and org-wide): excess runs queue and start automatically when a slot frees.
- **Per-task circuit breaker**: more than the configured runs per hour on one task pauses automation on that task until a human changes its status.

Org-wide caps (run concurrency, per-task runs per hour) ship as fixed platform defaults; per-agent budget and parallelism live in the agent's configuration.

## Choosing an assignee

Not every task belongs on a coding harness. Use this rule of thumb:

| Task shape                                          | Assign                                                                                                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Research, writing, summaries, personal deliverables | A **person** — disable unassigned triage on personal projects so agents do not auto-pick them up                                               |
| Board work driven by a deployed workflow            | An **Automation** — its workflow then drives the board's status verbs                                                                          |
| Repository work — bugs, features, refactors, PRs    | An **Agent** on a coding [**Harness**](/platform/agents/harnesses) — create it on the project's Agents tab with the harness that fits the work |

The assignee picker groups **Agents** and **Automations**. Each agent runs in a sandbox on the **Harness** chosen when it was created, pre-equipped with its skills, connectors, and instructions.

## The kill switch

The `task_automation` governance policy carries the master switch: switching it off stops the run path — in-flight work finishes, nothing new starts. It is admin-only and audited; on a self-hosted instance the policy is one of the org's governance config files, alongside the limits covered on [Policies and limits](/platform/admin/governance/policies-and-limits).

## Where this fits

Task automation is what turns the project board from a to-do list into a delegation surface: a human assigns and completes, the pack runs everything in between, and _Done_ stays a human decision. The natural next read is [Backlog](/platform/projects/backlog) for how proposed work enters the loop, and [The workflow editor](/platform/automations/editor) for tuning the pack's own workflows.
