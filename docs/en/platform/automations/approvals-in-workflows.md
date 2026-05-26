---
title: Approvals in workflows
description: A workflow step can be an approval gate that pauses the run until a human decides. This page covers the gate's states, the routing rules, what the rest of the workflow sees, and how the gate composes with org-wide approval rules.
---

An approval gate is a workflow step whose only job is to pause the run until a human decides. The step before the gate runs to completion, the gate publishes an approval card to the configured pool, and the step after the gate runs only when an approver clicks Approve. Editors and Developers configure gates inside the workflow; the approver pool decides them from the inbox or inline in chat. This page covers the gate as a workflow primitive — its states, its routing, what data it carries, and how it composes with org-wide approval rules.

The org-wide story of what an approval is, what it leaves behind, and how the four trigger sources differ lives on [Approval concepts](/platform/approvals/concepts). The per-rule configuration fields used by both gates and org-wide rules live on [Configure approvals](/platform/approvals/configure). What follows is the workflow-specific surface.

## Adding a gate to a workflow

Open the workflow editor and drop in an **Approval** step where the gate should sit. The step's panel asks for four things: the **approver pool** (team, role, or explicit list), the **timeout** and **timeout action** (Reject, Escalate, Approve), the **card title and body** (what the approver sees), and the optional **comment policy** (may, must, cannot). Save the workflow; the next run treats the step as a hold.

The card's title and body are rendered with the workflow's variables in scope, so you can build a card body like `Send mail to {{recipient}} with subject "{{subject}}"?` — the approver sees the resolved values, not the template. The same templating works on every text field on the step.

## What the gate carries

When the gate fires, Tale builds an approval card that carries:

- The workflow's name and the run's identifier.
- The step's title and body (with variables resolved).
- A link back to the run's execution view.
- The output of every prior step that the workflow author marked as visible to approvers.

The visible-prior-steps lever is on each prior step's output panel: check the box to expose the output to downstream approval cards. Outputs left unchecked are invisible to the approver — useful when an intermediate step produces something the approver does not need to see.

## States and what happens on each

The gate has the same four states every approval has — pending, approved, rejected, timed-out — and the run reacts to each one differently.

- **pending** — the run is paused. The execution view shows the step as waiting; downstream steps do not fire.
- **approved** — the next step in the workflow runs. If multiple gates were stacked back-to-back, each one has to approve independently.
- **rejected** — the run ends with a rejection record. The execution view captures the rejector, the timestamp, and the optional comment. Downstream steps never fire.
- **timed-out** — the gate's timeout action decides what happens. Reject ends the run; Escalate re-routes the card to the escalation pool and the gate goes pending again; Approve auto-allows and the next step runs.

State transitions are append-only — a resolved gate cannot be re-opened. To re-run after a rejection, start a new execution of the workflow.

## Composing with org-wide rules

A workflow gate is one of the four [approval trigger sources](/platform/approvals/concepts). The other three (knowledge-base writes, integration calls, agent and skill installs) can also fire on the same run if the workflow's steps touch those resources. When more than one rule applies to the same action, the engine evaluates all of them in parallel and the action is held until each approves — see [Configure approvals](/platform/approvals/configure) for the composition rules.

The practical consequence: if your workflow's `Send mail` step is already gated by an org-wide rule on outbound mail, you do not also need an in-workflow Approval step before it. The org-wide rule will hold the action regardless of how the workflow tried to invoke it.

## A worked gate

A daily-report workflow has three steps: an agent that drafts a summary, an Approval gate routed to the team lead, and a mail step that sends the approved draft. The gate's title is `Approve daily report`, its body is `Send today's report to the team? Draft below:`, the visible prior step is the agent's draft, the timeout is 4 hours, and the timeout action is `Reject`. If the team lead clicks Approve, the mail step fires with the draft as its body; if they Reject, the run ends and the day's report is not sent; if 4 hours pass without a click, the run records a timeout-reject and the next morning's run starts fresh.

## Where this fits

Approval gates are how a workflow puts a human between two automated steps. The natural next read is [Automation concepts](/platform/automations/concepts) for the surrounding model — workflows, triggers, steps, executions — and [Approval concepts](/platform/approvals/concepts) for the cross-trigger story of what every approval carries.
