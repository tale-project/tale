---
title: Workflow metrics
description: The dashboard that rolls run history into success rate, average duration, total runs, and failed runs across every workflow in the org — over the last 7, 30, or 90 days. Editors and Developers read this when a workflow is degrading or to spot which workflows carry the load.
---

The metrics dashboard is the org-wide read-out of how workflows are performing. Every execution rolls into four headline counters (total runs, success rate, average duration, failed runs), two charts (runs over time, status breakdown), and a top-workflows table that ranks the busiest definitions. Editors and Developers read it when a workflow is failing more than usual, when latency is creeping up, or when a stakeholder asks which workflows are doing the work.

The dashboard has no sidebar tab of its own — reach it through a direct link, or from the executions tab of a workflow you are already investigating. Pick a period — 7, 30, or 90 days — and every panel re-computes against the runs that started inside that window.

## The four headline cards

The cards above the charts summarise the period in one glance. Each card shows a single number for the selected period.

| Card         | Type       | Required | Description                                                                       |
| ------------ | ---------- | -------- | --------------------------------------------------------------------------------- |
| Total runs   | Number     | yes      | Count of executions that started in the window, across every workflow in the org. |
| Success rate | Percentage | yes      | Share of completed runs over total runs. Excludes runs still in progress.         |
| Avg duration | Duration   | yes      | Mean wall-clock duration of completed runs in the window.                         |
| Failed runs  | Number     | yes      | Count of executions that ended in the `failed` status.                            |

The cards roll up across every workflow. Use the top-workflows table below to attribute the totals to specific definitions.

## The trend and status charts

Two charts sit under the cards. The trend chart plots runs per day across the selected period — a quick read on whether the org is running more or less automated work over time. The status chart breaks the same total into completed, failed, and running buckets so you can see the failure share at a glance.

Both charts share the period control at the top of the page. Hover any bar or slice and the tooltip carries the precise count.

## The top-workflows table

The table at the bottom of the page ranks the workflows by run count over the window. Columns: workflow name, total runs, success rate, average duration, failed runs, last-run timestamp. Click a row to jump into that workflow's executions tab — the natural drill-down when a metric looks wrong and you want to see the underlying runs.

The list is capped at the most-recent 5,000 executions in the window. When the cap binds, the page surfaces a banner that says so — older runs in the same period are not included in the totals. Tighten the window or open the workflow's executions tab directly when the cap is biting.

## A worked investigation

A stakeholder asks why the daily-report workflow is slower this week. Open the metrics dashboard and switch the period to **Last 7 days**. The headline cards show success rate is flat at 100% but average duration is up 40%. The trend chart confirms a steady volume — the slowdown is per-run, not load-driven. The top-workflows table sits the daily report in the top three; click into it, then sort the **Executions** tab by duration descending. The slowest runs share an agent step that produces a longer-than-usual summary. From there, you tighten the prompt or trim the input set; the next morning's metrics card confirms the fix.

## Where this fits

Metrics is the roll-up; [execution logs](/platform/workflows/execution-logs) is the per-run detail the roll-up reads from. Use metrics to spot a workflow that needs attention, then drill into the workflow's executions tab to find the specific run that misbehaved. For org-wide token and cost accounting (rather than runs and durations) the [audit log](/platform/admin/governance/audit-logs) and the usage ledger under [policies and limits](/platform/admin/governance/policies-and-limits) carry the per-member spend.
