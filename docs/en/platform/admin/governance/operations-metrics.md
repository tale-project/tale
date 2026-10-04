---
title: Operations metrics
description: Check failed and blocked chat replies, agent turns in the sandbox, automation run outcomes, and project delivery under Settings > Metrics.
---

Beside [Usage](/platform/admin/governance/usage-analytics) and [Feedback](/platform/admin/governance/feedback-analytics), **Settings > Metrics** holds four dashboards for Owners and Admins. **Chat health** shows whether assistant replies fail or are blocked, **Harness turns** whether agents working in the sandbox finish their turns, **Automations** how live automation runs end, and **Projects** how one project's tasks move. Each dashboard recomputes its figures from the records Tale still keeps for the period you choose.

<Frame caption="Settings > Metrics > Chat health: the turn counts and rates, the daily outcome chart, and the breakdown by agent and model.">

![The Chat health dashboard for the last seven days, reporting seven assistant turns with a 0% error rate, a 0% blocked rate and no guardrail events, a bar of seven successful turns on the current day, and a breakdown that attributes every turn to plain chats and splits them between two models.](/images/platform/metrics-chat-health.webp)

</Frame>

## Check chat health

Open **Chat health** when members report failed or refused replies. Choose 1, 7, or 30 days under **Filter**; the page opens on 7 days.

The cards count **Assistant turns**, the replies the assistant produced in the period. **Error rate** is the share of those turns that ended in an error, and **Blocked rate** the share Tale refused to answer, for example because a guardrail blocked the message. **Guardrail events** counts the detections in the period and how many of them blocked a message.

**Turns over time** splits each day's turns into **Successful**, **Errors**, and **Blocked**, so you can see when a problem started. **Breakdown** gives each agent's and each model's share of the turns; a reply in a plain chat, outside any agent, counts as **Unattributed**.

Under **Errors**, **By error type** groups the failures, for example **Rate limited**, **Model not found**, **Credit exhausted**, or **Usage limit reached**, and **Recent errors** lists the latest ones with their model and agent. The type points to the next check: a provider credential or its quota under [AI providers](/platform/admin/providers), a model's availability under [Models](/platform/admin/governance/content-models), or a budget rule under [Policies and limits](/platform/admin/governance/policies-and-limits).

**Guardrails** breaks the guardrail events down by kind and by filter and charts detections, blocks, and filter errors per day. Those events come from the filters on [Guardrails](/platform/admin/governance/guardrails) and cover only the events retention still keeps.

## Watch harness turns

A harness turn is one piece of work an agent harness, such as Claude Code or Codex, carries out in the sandbox: a [project agent](/platform/projects/project-agents) working on a task, or an agent step in an automation. **Harness turns** shows whether those turns finish. Choose 7, 30, or 90 days; the page opens on 30 days.

The cards report **Total turns**, the **Success rate**, the **Timeout rate**, the **p95 duration**, which 95% of the turns finished within, and the turns **Stopped by user**. **By harness** repeats the turns, success rate, and timeouts for each harness, so a rising timeout rate points to the harness it comes from. [Harnesses](/platform/agents/harnesses) explains how each one runs, and [Sandboxes](/platform/admin/sandboxes) where their capacity is set.

## Follow automation runs

**Automations** counts live runs of your organization's automations; test runs appear on each automation's **Runs** tab but not here. Choose 7, 30, or 90 days; the page opens on 30 days. Each card compares its figure with the period of the same length before it.

**Success rate** is the share of finished runs that succeeded: runs that failed or were stopped count against it, while queued, running, and waiting runs do not count yet. **Avg duration** averages the finished runs, and **Failed runs** counts the failures. **Runs over time** shows the daily volume, **Status breakdown** the outcome of every run in the period, and **Top automations** the ten automations with the most runs, with their success rate, average duration, failures, and last run. Open a failing automation's **Runs** tab to find the node that failed; [Read automation runs](/platform/automations/execution-logs) walks through it.

## Review a project's delivery

**Projects** shows one project at a time: choose it under **Select a project**. If the organization has a single project, it is selected for you. Choose 7, 30, or 90 days; the page opens on 30 days.

| Figure | What it measures |
| --- | --- |
| **Completed** | Tasks that reached Done in the period, split by current assignee into tasks assigned to an agent and all other tasks. |
| **Avg cycle time** | The average time from a task's first move to In progress until it reached Done. A task that skipped In progress has no cycle time. |
| **Intervention rate** | Changes requested in review plus escalations (questions that agent steps in automations asked people), per agent run started in the period. |
| **Spend** | The cost of the project's agent runs, with how many started and how many failed. |

The charts below show the open tasks by status at the end of each day, the tasks created and completed each day, the cycle-time trend, each day's completions split into **Agents** and **Humans**, and the daily spend. That split, like the one under **Completed**, goes by each task's assignee as it is now, not by who completed the task. A task assigned to an agent counts for agents, although a person moved it to Done; a task assigned to a person, an automation, or no one counts for humans. Past days change too: when a task is later assigned to an agent or loses its agent, for example because the agent was deleted, its completion moves to the other side. A task created directly in Done or Cancelled gets a completion timestamp at creation, but daily completion throughput counts status-change events only, so that creation is not counted as a completion event.

A rising intervention rate with a steady number of runs means people are sending more work back or agents are asking more questions. Escalations come from agent steps in automations working on the project, and each one counts on the day it is raised, whether or not anyone answers. For work sent back, read the tasks in review before changing an agent's instructions under [Project agents](/platform/projects/project-agents); for questions, read the runs of the automation that asked them, as [Read automation runs](/platform/automations/execution-logs) explains.

## Read the figures correctly

- Every dashboard works from the records Tale keeps. Retention settings and deletions shorten the history, so an empty period can mean the records are gone rather than that nothing happened.
- A busy period can exceed what one pass reads: Chat health, Harness turns, Automations, and Projects each count at most the 5,000 most recent records of a kind in the period. When Tale shows a notice about recent activity, narrow the period before drawing conclusions.
- Cost figures are recorded application usage, not a provider's invoice; [Usage analytics](/platform/admin/governance/usage-analytics) explains the difference.
