---
title: Workflow concepts
description: A workflow is a step definition plus a trigger plus a run history. This page names the four pieces and shows how a daily report flows through them.
---

A workflow is the unit Tale reaches for when the work is multi-step and you want approvals, scheduling, or external triggers between the steps. It is a step definition plus a trigger plus a run history — three things you compose to turn a recurring task into a graph that executes itself.

This page hands you the vocabulary the rest of the workflows section assumes. Read it before you build a workflow, and come back when you cannot remember whether a behaviour belongs in a step, in the trigger, or in an approval gate.

## The four pieces

**The definition** is the ordered set of steps with their inputs and outputs. Steps can run sequentially, in parallel, or behind a conditional branch. A workflow is versioned; each save snapshots a new version you can roll back to.

**Triggers** decide when a workflow runs. Four trigger types ship: manual (a button in the UI), schedule (cron-shaped), webhook (an external system POSTs to a URL), and event (something happens inside Tale — a document is uploaded, an agent finishes a reply).

**Steps** are what runs. Built-in step types call agents, run sandbox code, hit external APIs, write to the knowledge base, send mail, or pause for human input. Steps that touch the outside world are wrapped in idempotency keys so a retry does not double-fire.

**Executions** are the run history. Every workflow invocation creates an execution record: who triggered it, what each step received and emitted, where the failures were, how long it took. The execution log is the audit trail and the debugging surface in one place.

## Approvals as gates

A workflow step can be an approval gate. The run pauses, an approval card surfaces in the configured approver pool, and the next step only fires when an approver clicks Approve. Reject ends the run; timeout escalates or fails based on the gate's configuration. Approvals are the seam between automation and human judgement.

The [Approvals in workflows](/platform/workflows/approvals-in-workflows) concept page covers the gate's states and the routing rules in detail.

## Putting it together — a daily-report workflow

A daily-report workflow puts the four pieces in one chain:

- Trigger: a schedule that fires every weekday at 08:00.
- Step 1: an agent that summarises yesterday's customer conversations from the inbox.
- Step 2: an approval gate routed to the team lead — Approve to send, Reject to discard.
- Step 3: a mail step that sends the approved summary to the team's distribution list.

Each run records the agent's draft, the approver's decision, and the mail step's recipient list. If a step fails — the agent times out, the approver does not respond, the mail server is unreachable — the execution captures the error and the failed step is retryable from the execution view.

## When to reach for it

| Use … when                                              | Workflow | Agent | Cron job |
| ------------------------------------------------------- | -------- | ----- | -------- |
| Work has multiple steps with dependencies               | ✓        |       |          |
| You need a human approval between steps                 | ✓        |       |          |
| The same prompt recurs but always one-shot              |          | ✓     |          |
| You only need a recurring shell command on a Linux host |          |       | ✓        |

Agents are the right shape for one-shot conversations; workflows are the right shape when the work has stages and you want each stage's input, output, and approver captured.

## Build one

The definition, triggers, steps, and executions are the four pieces every Tale workflow is made of: the definition is the recipe, the trigger is the kick-off, the steps are the moves, and the execution is the record. Reach for a workflow when the work has stages; reach for an agent when the conversation stays in one voice. The natural next read is [Workflow with approvals](/tutorials/editor/workflow-with-approvals) — it walks the four pieces end to end on a fresh instance.
