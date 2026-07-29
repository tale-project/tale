---
title: Execution logs
description: How to read an automation's runs — the statuses, the mode, what started each one, the per-node results and effects, and a worked session that finds a failure.
---

Every start of an automation opens a run, and the run keeps writing to itself until it finishes. It records what started it, which version it used, what it received, what each node produced, and everything it changed outside the platform. This is the surface every other automations page points at when something did not happen the way you expected, so it is worth knowing how to read one before you need to.

## The run list

An automation's page ends with a **Runs** list, newest first. Each row carries the run's status, whether it was a test or a live run, the version it ran, when it started, and what started it. A run that failed or is waiting shows the reason on the row itself instead of the starter, so the list often answers the question without being opened.

An automation that has never run says so rather than showing an empty table.

## What each status means

| Status        | What it tells you                                                 |
| ------------- | ----------------------------------------------------------------- |
| **Queued**    | The run exists and is waiting for the engine to pick it up        |
| **Running**   | The engine is working through the nodes                           |
| **Waiting**   | The run is parked on a human decision or an answer it needs       |
| **Succeeded** | Every node the graph reached finished and the output was produced |
| **Failed**    | A node errored and nothing was configured to carry on past it     |
| **Stopped**   | Somebody cancelled the run; work already performed is not undone  |

**Waiting** is the one people misread. It is not a stall and not a failure — the run is holding its place and will carry on from the node it stopped at as soon as the decision it needs is made. [Approvals in workflows](/platform/automations/approvals-in-workflows) covers what it is waiting for.

## Test runs and live runs

Every run is marked as one or the other, and the difference is whether the outside world was touched. A **test** run uses each connector's deterministic stand-in: no mail leaves, no record is written, nothing is charged. A **live** run may do all three, which is why starting one is a developer-level action and why every effect it produces is recorded.

Reading a test run tells you whether the graph and the data flow are right. Only a live run tells you whether the outside systems behaved.

## Reading one run

Open a run and you get the automation's canvas with that run painted onto it, plus the run's own facts around it: the version, the mode, when it started, and when it finished.

### Per-node results

Every box on the canvas carries the status the run gave it — it **Ran**, was **Skipped**, **Failed**, was **Never reached**, or has **Not reached yet** while the run is still going. A failure is therefore a position in the graph rather than a line to search for, and the nodes downstream of it show plainly as never reached.

Select a node and the panel shows what happened to it: the **Resolved input** it actually received once every template had been evaluated, and its **Output**. Resolved input is the single most useful field on this page. It shows the value a reference produced rather than the reference you wrote, which is how a template that quietly resolved to nothing gets caught.

Skipped nodes are worth reading rather than glossing over, because the reason differs: a node can be skipped by its own condition, by a node it depends on having been skipped, because it is the else-branch of a node that ran, or because it failed under a setting that lets the run continue.

### Effects

A run also keeps the ordered list of everything it changed outside the platform — each entry naming which node caused it, which connector was called, and the input it was called with. A run that changed nothing outside the platform says so explicitly, which is a real answer rather than an empty section.

The effects list is what makes a run auditable after the fact. When someone asks whether a message actually went out, this is the list that answers, and it stays with the run permanently.

## Why a long run does not repeat itself

A live run does not execute in one go. It steps node by node, and every completed node is checkpointed before the next one starts, so when a run reaches the platform's time window it hands itself back and resumes from the last completed node. A node that already ran is never reached a second time, which is what stops an interrupted run from sending the same message twice.

The same checkpoints cover a run whose continuation was lost. A run left in a non-terminal state past a grace period is picked back up automatically and continues from where its checkpoints say it got to, rather than restarting or sitting unfinished forever.

## A worked debugging session

The daily reminder did not go out. Open the automation and look at the **Runs** list: this morning's run is there and it is **Failed**, with its reason on the row.

Open it. The canvas shows the first three nodes as having run, the fourth as failed, and everything after it as never reached — so the question is already narrowed to one box. Select the failed node and read its **Resolved input**: the customer name is present, the invoice id is an empty string. That points one node upstream.

Select that upstream node and read its output. It returned a record with no `id` field, because the field it was reading had been renamed. The template referencing it resolved to nothing, and the node downstream failed on the empty value rather than on anything wrong with itself.

<Tip>

Read the effects list before you fix anything. It tells you whether the run got far enough to touch the outside world, which decides whether re-running is harmless or needs cleaning up first.

</Tip>

Fix the reference in the node panel, save a version with a message naming the renamed field, and press **Test run**. The mock run walks the same graph and this time every box shows as having run. Deploy that version, and tomorrow's schedule picks it up.

## Stopping a run

While a run is unfinished you can stop it, and a stopped run is terminal — the engine checks at every node boundary and stops scheduling the next one. Work already performed is not rolled back, because it cannot be: a message that was sent is sent. Read the effects list to see exactly how far it got before deciding what to do next.

## Where this fits

A run is the receipt an automation leaves behind: its status says what happened, its per-node results say where, its resolved inputs say why, and its effects say what it changed outside the platform. Pair this page with [Workflow triggers](/platform/automations/triggers) for the kinds of start that open these records, and with [audit logs](/platform/admin/governance/audit-logs) for the organization-wide trail of who changed what.
