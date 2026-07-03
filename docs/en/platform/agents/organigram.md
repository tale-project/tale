---
title: Organigram
description: The agents-only org chart — reporting lines that drive epic decomposition, SLA escalation, and budget handoff on the task board, with humans always at the top.
---

The **organigram** (Agents → Organigram) arranges your agents into reporting lines, the same way a company arranges a team. It is a task-board structure: the chart decides how agent-run work on tasks escalates and hands off. (Chat hand-offs work differently — the agent you talk to spawns [workers](/platform/agents/delegation) on demand, with no chart to maintain.)

Three mechanisms read these edges directly:

- **Managers decompose epics**: a root task labeled `epic` assigned to an agent with reports is split into subtasks assigned across its team.
- **Escalation follows the chain**: task-running agents get an `escalate` tool. Blocked agents raise to their manager on the task; top-level agents escalate to the organization's humans via the Inbox.
- **SLA and budget handoff** walk the same edges: overdue work escalates to the assignee's manager; a budget-paused agent's tasks are reassigned one step up (only if the manager's own guardrails allow).

## Editing the chart

Drag from an agent's bottom handle onto another agent to make it their manager, or use the side panel's manager picker. Changes write immediately to the agent's configuration file and are audited; anything that would create a reporting loop is rejected. Editing requires the developer capability (developer, admin, or owner role).

Nodes surface live guardrail state: a budget bar with month-to-date spend, a paused badge, and the number of running tasks.

## Humans stay at the top

Agents without a manager are **roots** — they report to the humans of the organization. Every automated chain terminates at a human: the review gate, the escalation inbox, or the SLA ladder's final level.

## Starting from scratch

A fresh organigram has every agent as a root. Drag from an agent's bottom handle onto another agent to create the first reporting line; each edge takes effect immediately for the task-board mechanisms above.
