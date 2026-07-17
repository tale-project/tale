---
title: Build a workflow with an approval
description: Have the AI editor build a three-step workflow where a human decision sits between the draft and the send, approve its proposal, then run it end to end and inspect the journal.
---

A workflow with a human decision in the middle is the shape you reach for when the work has a draft, a review, and an action — and you want a person between the draft and the action. The run pauses as **Waiting for input** until someone answers; the next step only fires on a green light. This walk builds a daily-summary workflow that way, and you meet both human gates on the road: approving the AI editor's proposal, and answering the paused run.

You need an Editor role and one agent that produces a draft (the first useful agent from [Build your first agent](/tutorials/editor/first-agent-end-to-end) works fine). The conceptual side lives in [Automation concepts](/platform/automations/concepts) and [Approval concepts](/platform/approvals/concepts); this walk is the end-to-end mechanic.

## Before you begin

Confirm three things. Your role is at least Editor — workflow editing is gated to Editor and above. You have a draft-producing agent ready to call; without it the draft step has nothing to invoke. And you can answer the review yourself — the paused run waits for a human, and in this walk that human is you.

## Step 1 — Open a workflow in the editor

Workflows live inside the automation they power: open the automation and its **Editor** tab is the workflow, with the step graph on a canvas. For this walk, open a workflow you own or one your org's task-ops pack provisioned — anything you are allowed to edit works, because the AI editor builds the new definition for you either way.

## Step 2 — Describe the workflow to the AI editor

Toggle the **AI editor** on the canvas toolbar and describe the whole shape in one message:

> Every weekday at 08:00, have the <your agent> agent summarise yesterday's unread contact messages into one paragraph, then ask a human to review the draft, and only send the approved text to the team channel.

The AI editor answers with a proposal card — **Create workflow** with the step count, or **Update workflow** when it reworks the one you opened. Nothing touches the definition while the card is pending: expand it, check the steps it lists — an **LLM** step for the draft, the review pause, the send — and approve it. The change is applied and versioned like any manual save.

## Step 3 — Attach the schedule

Switch to the **Triggers** tab and click **Add schedule**. Pick the **Every day** preset and adjust the cron to weekdays (`0 8 * * 1-5`) — or describe the timing in plain language and click **Generate** to let the AI write the cron. **Workflow variables** pre-fills from the workflow's input schema; leave it as proposed. The row appears with an **Active** toggle already on.

## Step 4 — Run it and answer the review

Back in the editor, open **Test workflow**, paste the input JSON the panel proposes, and click **Execute**. The panel mirrors the run step by step: the draft step fires, then the run pauses — **Waiting for input** — and the review arrives as a form card holding the draft. Fill it and click **Submit response** to approve, or **Reply differently** to push back in free text; the run resumes with your answer and the send step fires.

Open the **Executions** tab and expand the run: the journal shows one entry per step — the draft the agent produced, who answered the review and what, and the send with its output. That journal is the audit trail; the same record appears for every future scheduled run.

## Where this fits

Draft, decide, act — with the decision a human's — is the smallest useful workflow-with-approval, and you built it without placing a single step by hand: the AI editor proposed, you approved, the run asked, you answered. The same shape scales — add a second review before a destructive step, or let [Approvals in workflows](/platform/automations/approvals-in-workflows) show you the other gates around a workflow. For the vocabulary behind definition, trigger, and execution, [Automation concepts](/platform/automations/concepts) is the page this walk assumed.
