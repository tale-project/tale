---
title: Automation metrics
description: Usage and performance KPIs across every automation in your organisation.
---

The Automation metrics dashboard is a cross-workflow view of how your automations are running. It rolls up every workflow in the organisation into four headline KPIs, a runs-over-time chart, a status breakdown, and a top-workflows table. Use it to spot the workflow that started failing yesterday, the one that grew 10x in volume after a process change, or the long tail of automations nobody is actually using.

The dashboard lives at **Automations > Metrics**. It's available to Admin and Developer roles, the same audience that can edit automations.

## What it shows

| Card / chart         | Reads                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Total runs**       | Count of executions in the selected period.                                                                        |
| **Success rate**     | Successful runs divided by total — `running` and `cancelled` are excluded.                                         |
| **Avg duration**     | Mean wall-clock duration of completed runs.                                                                        |
| **Failed runs**      | Count of executions that ended in failure.                                                                         |
| **Runs over time**   | Daily series of completed, failed, and running executions.                                                         |
| **Status breakdown** | Donut showing the share of each terminal status across the period.                                                 |
| **Top workflows**    | Table ranked by run count, with success rate, average duration, failed count, and last-run timestamp per workflow. |

Click a row in **Top workflows** to jump to that workflow's own [Execution logs](/platform/automations/execution-logs).

## Period selector

Switch between **Last 7 days**, **Last 30 days**, and **Last 90 days** from the period selector at the top of the page. The period choice is reflected in the URL (`?period=30`) so a link to the dashboard is always reproducible.

The dashboard caps each query at the most recent 5,000 runs in the selected window. When the cap is hit, a banner reads _"Showing the most recent 5,000 runs in this window. Older runs in this period are not included in these totals."_ — switch to a shorter window for a complete picture, or jump to **Top workflows** and inspect the per-workflow execution logs which are not capped.

## Empty state

If no workflows have run in the selected period, the dashboard shows an empty state with the headline _No workflow runs_ instead of zero-valued cards. That's the cue to either widen the period or check that your triggers are firing — see [Triggers](/platform/automations/triggers).

## Related

- [Execution logs](/platform/automations/execution-logs) — per-workflow run history with step-level detail.
- [Usage analytics](/platform/admin/usage-analytics) — token and cost trends across the whole organisation, including automations.

## Where this fits

Automation metrics is the cross-workflow dashboard — the surface that answers "is anything broken right now?" and "what changed since last week?" without opening every workflow individually. When a KPI changes, drill into [Execution logs](/platform/automations/execution-logs) for the per-run truth. For LLM-cost trends that span both automations and chat, [Usage analytics](/platform/admin/usage-analytics) is one tab over.
