---
title: Build a workflow with an approval
description: Wire a three-step workflow where a human approval gate sits between the draft and the send, then run it end to end and inspect the audit trail.
---

A workflow with an approval is the shape you reach for when the work has a draft, a decision, and an action — and you want a human between the draft and the action. The approval gate pauses the run until someone clicks Approve; the next step only fires on a green light. This walk builds a daily-summary workflow with a one-step approval gate on a fresh org.

You need an Editor role and one agent that produces a draft (the first useful agent from [Build your first agent](/tutorials/editor/first-agent-end-to-end) works fine). The conceptual side lives in [Automation concepts](/platform/automations/concepts) and [Approval concepts](/platform/approvals/concepts); this walk is the end-to-end mechanic.

## Before you begin

Confirm three things. Your role is at least Editor — workflow editing is gated to Editor and above. You have a draft-producing agent ready to call; without it, Step 2 of the workflow has nothing to invoke. You are a member of the approver pool you will assign in Step 3, or you have a teammate ready to approve so the run actually progresses.

## Step 1 — Create the workflow shell

The first move is the workflow definition — the ordered container the steps live in. Open **Automations > New workflow** and set:

- **Name** — `Daily inbox summary`
- **Trigger** — **Manual** for now; you can swap it for a schedule once the run works
- **Inputs** — leave empty

Save as a draft. The shell exists but has no steps; running it now would return immediately.

## Step 2 — Add the draft step

The draft step is the agent invocation. Click **Add step > Call agent** and configure:

- **Agent** — the draft-producing agent you have ready
- **Prompt** — `Summarise yesterday's unread customer messages into a paragraph and propose a single team-wide reply.`
- **Output variable** — `draft`

Save. The workflow now has one step; running it produces a `draft` variable but does nothing with it.

## Step 3 — Add the approval gate

The approval gate is the seam between the agent's draft and the action. Click **Add step > Approval gate** and configure:

- **Title** — `Review daily summary`
- **Body** — `{{ draft }}` so the approver sees the full text in the card
- **Approver pool** — a team or an explicit list of users you are part of
- **Timeout** — 30 minutes, escalate to fail

Save. Running the workflow now pauses on this step and waits for a decision; rejecting ends the run.

## Step 4 — Add the action step and run it

The action step runs only when the gate resolves Approve. Click **Add step > Send mail** (or any action your org has wired) and configure:

- **To** — your own address for this walk
- **Subject** — `Daily inbox summary`
- **Body** — `{{ draft }}`

Save and **Publish** the workflow. Click **Run**. The draft step fires; the approval gate appears as a card in your inbox; click **Approve**; the mail step fires; the run completes. The execution view shows three rows — draft, gate decision, mail — with timestamps and the actor on the gate.

## Where this fits

Three steps with one gate is the smallest useful workflow-with-approval: agent drafts, human decides, system acts. The same shape scales — swap manual for a schedule trigger, add a second gate before a destructive step, branch on the decision instead of failing on Reject.

For the gate's state machine and routing rules, see [Approvals in workflows](/platform/automations/approvals-in-workflows). For the four pieces every workflow is made of, see [Automation concepts](/platform/automations/concepts).
