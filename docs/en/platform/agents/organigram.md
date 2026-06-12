---
title: Organigram
description: The agents-only org chart — reporting lines that drive delegation, epic decomposition, SLA escalation, and budget handoff, with humans always at the top.
---

The **organigram** (Agents → Organigram) arranges your agents into reporting lines, the same way a company arranges a team. It replaces the old per-agent delegation checkboxes with one structural view, and it is not a diagram for show — the chart is functionally load-bearing.

Four mechanisms read these edges directly:

- **Delegation** is derived from it: every agent can delegate to exactly its direct reports — the chart is the single delegation configuration, with nothing to maintain per agent.
- **Managers decompose epics**: a root task labeled `epic` assigned to an agent with reports is split into subtasks assigned across its team.
- **Escalation follows the chain**: agents get an `escalate` tool. Blocked agents raise to their manager (which runs under the _manager's_ own budget); top-level agents escalate to the organization's humans via the Inbox.
- **SLA and budget handoff** walk the same edges: overdue work escalates to the assignee's manager; a budget-paused agent's tasks are reassigned one step up (only if the manager's own guardrails allow).

## Editing the chart

Drag from an agent's bottom handle onto another agent to make it their manager, or use the side panel's manager picker. Changes write immediately to the agent's configuration file and are audited; anything that would create a reporting loop is rejected. Editing requires the developer capability (developer, admin, or owner role).

Nodes surface live guardrail state: a budget bar with month-to-date spend, a paused badge, and the number of running tasks.

## Humans stay at the top

Agents without a manager are **roots** — they report to the humans of the organization. Every automated chain terminates at a human: the review gate, the escalation inbox, or the SLA ladder's final level.

## Starting from scratch

A fresh organigram has every agent as a root. Drag from an agent's bottom handle onto another agent to create the first reporting line; each edge takes effect immediately and shows up in the affected agents' delegation the same moment.
