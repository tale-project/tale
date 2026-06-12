---
title: Task automation
description: The default task-ops pack — how assigning a task to an agent runs it, the human review gate, guardrails (budgets, concurrency, circuit breakers), and the kill switch.
---

Assigning a board task to an AI agent puts it to work. The **task-ops pack** — thirteen file-based workflows provisioned to every organization — covers the full lifecycle: triage, execution, review, escalation, SLA enforcement, and cleanup. Every workflow is a plain JSON file your organization owns: tune the thresholds, edit the prompts, or deactivate individual triggers under **Automations**.

## The execution loop

1. **Assign** a task to an agent (or let _unassigned triage_ score and route new tasks automatically — high-confidence matches auto-assign, the rest get a suggestion comment).
2. The agent **acknowledges** (task moves to _In progress_), works in its own task thread with the task tools, and posts its result as a comment.
3. The task parks at **_In review_** — agents can never set _Done_; that rule is enforced server-side regardless of any workflow configuration.
4. A human **approves** (the only automated path to _Done_) or **requests changes** with feedback, which re-engages the same agent on the shared thread and opens a fresh review gate. Reviews are answerable from the task sheet or directly from the Inbox.

Failures roll the task back to _To do_ with an explanatory comment. Managers on the [organigram](/platform/agents/organigram) **decompose** root tasks labeled `epic` into subtasks for their direct reports instead of working them solo; the parent waits until the last subtask closes, then rolls up to _In review_.

## Mentions, dependencies, deadlines

- **@-mention an agent** in a task comment and it reads the comment and acts. The composer previews whether each mentioned agent will actually respond (automation off, budget exhausted, paused). Comments written by the automation itself never trigger anyone.
- When a **blocker closes**, dependent tasks get a remaining-blocker note; fully unblocked agent work restarts automatically, human work gets an inbox notification.
- **Due dates** drive a four-level SLA ladder: a 24h warning, an overdue nudge, a direct run by the assignee's manager agent, and finally a human escalation to the project creator and org admins. Each level fires at most once; pushing the due date out resets the ladder.

## Guardrails

Every agent run — assignment, mention, revision, escalation, external — passes the same admission gate:

- **Budgets** (per agent, monthly): at the warn threshold the agent gets an economy instruction and admins are notified once; at the pause threshold new runs are refused and open tasks are handed off per org policy (to the manager, or unassigned for triage). Resets at month rollover.
- **Concurrency caps** (per agent and org-wide): excess runs queue and start automatically when a slot frees.
- **Per-task circuit breaker**: more than the configured runs per hour on one task pauses automation on that task until a human changes its status.

Org-wide defaults live under **Settings → Governance** (`agent_workforce` policy); per-agent budget and parallelism live in the agent's configuration.

## The kill switch

**Agents → Workforce** carries the master toggle: switching task automation off pauses the pack's triggers AND the run path itself — in-flight work finishes, nothing new starts. Admin-only, audited. See the [operations runbook](/self-hosted/operate/workforce-operations) for the full procedure.
