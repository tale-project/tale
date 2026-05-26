---
title: Execution logs
description: The per-workflow run history — every execution with its status, duration, trigger source, step inputs and outputs, and the full journal of what each step did. Developers and Editors read this when a run failed or behaved oddly.
---

Execution logs are the run history for a single workflow. Every time a trigger fires the workflow, Tale opens a new execution record and writes to it as the run progresses — start time, status, the input the trigger carried, the output each step emitted, the duration, and the error if a step failed. The page is the debugging surface every other automations tab points at when something went wrong.

The list lives on the **Executions** tab of an automation. Open the automation, click **Executions**, and the table loads the most recent runs. Each row expands into a JSON view of the execution, its variables, and the step-by-step journal.

## The list view

The list shows one row per run, sorted by start time. The columns are the execution ID, the status badge, the start time (down to the millisecond), the duration, and the trigger source. The toolbar above carries a search box (matches an execution ID), a status filter, a triggered-by filter, and a date-range picker.

| Column       | Type      | Required | Description                                                                                                            |
| ------------ | --------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| Execution ID | String    | yes      | Stable identifier for the run. Click the copy icon to put it on the clipboard.                                         |
| Status       | Badge     | yes      | One of `running`, `completed`, `failed`, `pending`, or `waiting_for_input` (when an approval gate has paused the run). |
| Started at   | Timestamp | yes      | Wall-clock time the run started, in the org's timezone.                                                                |
| Duration     | Number    | no       | Wall-clock time from start to completion. Empty for a still-running execution.                                         |
| Triggered by | Enum      | yes      | One of `schedule`, `manual`, `webhook`, `event`, `api`, or `system`.                                                   |

The pageful loads incrementally — scroll to the bottom and the next pageful fetches. The approximate row count in the toolbar is a cheap estimate; the exact count is not maintained.

## The expanded execution view

Expand a row and Tale renders a JSON view of the run. The top level carries five fields: the execution metadata (id, status, start and finish times, the trigger source, the error if any), the run-level metadata block from the trigger, the input variables the run received, the step journal, and a journal-error string if the journal failed to load.

The journal is the per-step record: every step in the run emits a journal entry with its inputs, its outputs, and its status. A failed step carries the error string and the step config that produced it; an approval-gate step carries the approver and the decision. Use the journal to follow the run end to end and to spot the step that misbehaved.

## Retry and re-run

Step-level retries are built in. Every step type accepts a `retryPolicy` (max attempts and backoff in milliseconds) on the step config; transient failures retry automatically up to the configured ceiling. The workflow-level default applies when a step does not declare its own policy. Open the step's panel in the editor to inspect or change the policy.

A run that fails past its retry budget stays in the execution log as `failed`. To re-run with the same inputs, open the **Test automation** panel from the editor toolbar, paste the original input JSON (copy it from the failed execution's variables block), and click **Execute**. The new run is a fresh execution with its own ID; the previous failure stays in the log for the audit trail.

## A worked debugging session

A daily-report run failed at 08:01. Open the workflow, switch to **Executions**, and filter by `Status = failed` and `Date = today`. The failing execution sits at the top. Expand it: the journal shows the second step (an agent summary) errored with `request timed out`. The step's variables block carries the prompt the agent received; the error and the prompt together usually point at the root cause — too many tokens, a missing knowledge document, an over-eager tool call. Fix the underlying issue, then re-run the workflow from the test panel with the same input to confirm the fix.

## Where this fits

Execution logs are the receipt every workflow leaves behind; they are how you know what ran, what it produced, and where it broke. Pair them with [metrics](/platform/automations/metrics) for the same information rolled up across runs (success rate, p50/p95 duration), with [triggers](/platform/automations/triggers) for the kick-off that opens each execution, and with [audit logs](/platform/admin/governance/audit-logs) for the org-wide trail of who started which run.
