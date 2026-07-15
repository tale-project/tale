---
title: Approvals in workflows
description: Where humans decide around workflows — approving the AI editor's changes to a definition, approving an agent's request to run a workflow, and answering the questions that pause a run.
---

Workflows run without you, but they change and start only with you. Three human gates surround every workflow: the AI editor's changes to a definition apply only after you approve them, an agent that wants to run a workflow needs your sign-off first, and a run that hits a question pauses until someone answers. This page covers the three gates; the org-wide story of what an approval card is lives on [Approval concepts](/platform/approvals/concepts).

<Frame caption="The AI editor beside the canvas — its edits arrive as approval cards, never as silent changes to the definition.">

![The workflow editor with a step graph on the canvas and the AI editor panel open on the right, where proposed workflow changes appear for approval.](/images/platform/automation-editor-canvas.webp)

</Frame>

## Approving changes to a definition

Ask the **AI editor** to build or rework a workflow and its proposal lands as a card in the panel — a **Create workflow** card with the step count for a new definition, or an update card badged by scope: **Update step** for a single-step patch, **Update {count} steps** for several, **Update workflow** for a full save. Approve and the change is applied and versioned like any manual save; **Cancel** discards it. Nothing touches the definition while the card is pending.

## Approving a run

An agent in chat with the workflow tools can ask to start a workflow. The request arrives as a card naming the workflow — expand **Show parameters** to inspect the exact input it will run with — and holds until you click **Run workflow** or **Cancel**. After approval the same card tracks the live run: the current step, elapsed time, and the outcome, with **Stop** to cancel mid-flight and **View execution details** to jump to the run's journal.

<Note>

The chat is blocked while a request is pending — **Respond to the pending request above to continue**. Decide the card before sending the next message.

</Note>

## Answering a paused run

A run that needs a human answer pauses with the **Waiting for input** status in the [execution list](/platform/automations/execution-logs). The question arrives as a form card — fill it and click **Submit response**, or click **Reply differently** to push back in free text. The run resumes with your answer as the step's input, and the journal records who answered and what.

## What each decision leaves behind

Every gate resolves to the same states — **Pending**, **Executing**, **Completed**, or **Rejected** — visible on the card itself, and the decision lands in the [audit log](/platform/admin/governance/audit-logs) with the actor and timestamp. A resolved card cannot be re-opened; to retry a rejected run, ask again and decide the fresh card.

## Where this fits

These gates are the workflow-side face of one product-wide pattern: an agent proposes, a human disposes. [Approval concepts](/platform/approvals/concepts) names every card type beyond workflows — document writes, knowledge writes, integration calls — and [Configure approvals](/platform/approvals/configure) shows where the requirements are declared.
