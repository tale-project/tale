---
title: Execution logs
description: Read past automation runs, debug failures, and replay with new input.
---

The **Executions** tab on every automation is the per-run record of everything that has tried to run it — schedules, webhooks, events, and manual runs alike. Each row is one run, each row expands into the step-by-step trace of inputs, outputs, and errors that produced it. This is where a Developer or Admin goes when a third-party API returned `400` overnight and the question is "which step, with what payload, against which model".

Runs are kept according to the organisation's [retention policy](/platform/admin/governance#retention). Past that horizon, rows are hard-deleted by the daily cleanup job; long-lived debugging means copying the trace before that happens.

## A worked failure

Click any row to expand it. The detail panel shows a JSON view of the whole run, structured like this:

```json
{
  "execution": {
    "id": "exe_…",
    "status": "failed",
    "startedAt": "2026-05-15T09:12:04.317Z",
    "completedAt": "2026-05-15T09:12:06.842Z",
    "triggeredBy": "webhook",
    "error": "Shopify returned 400: 'price' must be a positive number"
  },
  "metadata": { … trigger source, webhook token id, idempotency key … },
  "variables": { … workflow variables at run time … },
  "journal": [
    { "step": "Start", "status": "completed", "input": { … }, "output": { … } },
    { "step": "Fetch order", "status": "completed", "output": { … } },
    { "step": "Create line item", "status": "failed", "error": { … } }
  ]
}
```

The `journal` is the load-bearing field — every step that ran is recorded in order, with the literal input it saw, the output it produced, and the error if it threw one. Failed steps stay expanded by default, so the failure points itself out without you hunting through siblings.

## Filtering and search

The filter bar above the table covers the cases you reach for most often.

| Filter           | Values                                                                       |
| ---------------- | ---------------------------------------------------------------------------- |
| **Status**       | `running`, `completed`, `failed`, `pending`.                                 |
| **Triggered by** | `schedule`, `manual`, `event`, `webhook`, `api`, `system`.                   |
| **Date range**   | Today, last 7 days, last 30 days, all time, or a custom from/to.             |
| **Search**       | Exact match on the run id; useful when you have the id from an error report. |

The table loads the most recent runs in pages and reads infinite-scroll style as you go deeper. Filters compose — `status: failed` plus `triggered by: webhook` plus the last 24 hours narrows to "what blew up on inbound traffic since this morning".

## Rerunning

From an expanded row, two actions replay the run:

- **Rerun with same input** starts a fresh run using the original payload. Useful when the automation has changed since the original failure and you want to confirm the fix.
- **Rerun with different input** opens the payload in an editor so you can tweak before firing. Useful for probing edge cases — change one field, observe which step branches differently.

Reruns land on the **Executions** tab as new rows; the original failure stays in place so the audit story remains intact.

## Alerts

The **Alerts** tab on an automation lets you wire failure notifications to an Admin's email — fire when a run fails, when it runs past a threshold, or when the error matches a pattern. The per-automation alerts cover the per-automation case; for "more than five failures in the last hour across every automation in the org", reach for [Operations](/self-hosted/operate/observability/operations) instead — it carries the cross-automation rollup the alerts surface deliberately does not.

## Where this fits

Execution logs are the per-automation debug surface — the **Executions** tab on the automation in front of you. For the cross-automation rollup (total runs, success rate, top automations by volume), [Automation metrics](/platform/automations/metrics) is the dashboard. For org-wide error trends that mix automations and chat together, [Operations](/self-hosted/operate/observability/operations) is the right surface, one tab over.
