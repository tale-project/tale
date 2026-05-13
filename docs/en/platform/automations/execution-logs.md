---
title: Execution logs
description: Inspect past workflow runs, debug failures, and rerun with tweaks.
---

The Executions tab on any workflow lists every run — scheduled, event-triggered, webhook, or manual — with timestamps, duration, final status, and step-level detail.

## What an execution record shows

Click a row in the Executions table to open the detail panel:

- **Overview** — trigger type, start and end time, duration, final status, and the full input payload.
- **Steps** — each step with its status (success, failure, skipped), input, output, duration, and any error message.
- **Variables** — the workflow variables at the time of the run (helpful if you've changed them since).
- **Raw** — the JSON trace of the whole run, exportable with a copy button.

Failed steps expand by default so you can see the error without clicking around.

## Filtering and searching

The Executions table supports:

- **Status filter** — success, failure, running, cancelled.
- **Time range** — last hour, last 24 hours, last 7 days, custom range.
- **Trigger filter** — schedule, event, webhook, manual.
- **Text search** — matches on trigger name, error message, and step input/output.

## Rerunning

From an execution's detail panel you can:

- **Rerun with same input** — kick off a new execution using the original input payload. Useful when the workflow has changed and you want to replay a past request.
- **Rerun with different input** — edit the input payload before rerunning. Useful for debugging edge cases.

Reruns show up as fresh executions — the original record is preserved.

## Retention

Execution records are kept according to your organisation's [retention policy](/platform/admin/governance). By default, detailed step data is kept for 90 days and summary records for one year.

## Alerts

Configure alerts under the workflow's **Alerts** tab to email an Admin when a workflow fails, runs longer than a threshold, or produces an error matching a pattern. For cross-workflow alerting (e.g., "more than 5 failures in the last hour across all workflows"), use [Operations](/self-hosted/operate/observability/operations).
