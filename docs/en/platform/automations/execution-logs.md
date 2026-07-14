---
title: Execution logs
description: The per-workflow run history — every execution with its status, timing, and trigger source, expanding into a per-step journal. Read this when a run failed or behaved oddly.
---

Execution logs are the run history of a single workflow. Every time a trigger fires, Tale opens an execution record and writes to it as the run progresses — status, timing, the input the run received, and what every step consumed and produced. The **Executions** tab is the debugging surface every other automations page points at when something went wrong.

<Frame caption="The Executions tab — one row per run; the single red badge among the green ones is where a debugging session starts.">

![The Executions tab of an automation listing twelve runs — eleven with a green Completed badge and one with a red Failed badge — each with an execution ID, a start timestamp, a duration, and event as its trigger source.](/images/platform/automation-executions.webp)

</Frame>

## The list view

One row per run, newest first. The toolbar carries **Search by execution ID**, a **Filter**, and a date-range picker.

| Column       | Description                                                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Execution ID | Stable identifier for the run — the copy icon puts it on the clipboard.                                                                                               |
| Status       | **Pending**, **Running**, **Completed**, or **Failed** — plus **Waiting for input** when a run is blocked on a human, and **Paused** during a step-by-step debug run. |
| Started at   | Wall-clock start time, to the millisecond.                                                                                                                            |
| Duration     | Start to completion; empty while the run is still going.                                                                                                              |
| Triggered by | Which path started the run — a schedule, a webhook, an event, or a test from the editor.                                                                              |

## The expanded run

Expand a row and the record renders as JSON: the execution metadata (status, timing, trigger source, and the error if any), the metadata the trigger carried, the input variables, and the **journal** — one entry per executed step with its inputs, outputs, and status. A failed step carries the error string that killed it. Read the journal top to bottom and the run retells itself; the entry whose status flips is the step that misbehaved.

## Retries and re-runs

Transient failures retry on their own. The workflow's **Configuration** tab sets the default — **Max retries** and **Backoff (ms)** — and any step can override it in its own config.

<Frame caption="The Configuration tab — the retry budget and backoff every step inherits unless it overrides them.">

![The Configuration tab of an automation showing name and description fields, a timeout of 600000 milliseconds, max retries of 3, a backoff of 1000 milliseconds, and a variables JSON editor.](/images/platform/automation-configuration.webp)

</Frame> A run that fails past its retry budget stays **Failed** for the audit trail; to try again, open **Test workflow** in the editor, paste the input copied from the failed run's variables block, and click **Execute**. The re-run is a fresh execution with its own ID.

## A worked debugging session

A daily report did not arrive. Open the workflow, switch to **Executions**, and filter to today's failures — the failing run sits on top. Expand it: the journal shows the summarising step erred with a timeout, and its inputs carry the prompt it received. Fix the cause, re-run from the test panel with the same input, and watch the new execution complete before trusting tomorrow's schedule.

## Where this fits

Execution logs are the receipt every workflow leaves behind. Pair them with [triggers](/platform/automations/triggers) for the kick-off that opened each record, and with [audit logs](/platform/admin/governance/audit-logs) for the org-wide trail of who changed what.
