---
title: Approvals in workflows
description: Where humans decide around workflows — approving the AI editor's changes to a definition, approving an agent's request to run a workflow, and answering the questions that pause a run.
---

Workflows run without you, but they change and start only with you. Three human gates surround every workflow: the AI editor's changes to a definition apply only after you approve them, an agent that wants to run a workflow needs your sign-off first, and a run that hits a question pauses until someone answers. This page covers the three gates; the org-wide story of what an approval card is lives on [Approval concepts](/platform/approvals/concepts).

<Frame caption="An automation's canvas with its side panel — a proposed change arrives as an approval card and never edits the document silently.">

![The workflow canvas of an automation showing a graph of nodes, with a panel open beside it.](/images/platform/automation-editor-canvas.webp)

</Frame>

## Approving changes to a definition

Ask the assistant to build or rework an automation and its proposal lands as a card rather than as a change. The card names what it would do — create a new automation, patch a single node, or replace the whole document — and holds until you decide. Approve it and the result is saved as a new version exactly like a manual save, so the document you were looking at is untouched and the version that is live stays live until you deploy. Cancel discards the proposal, and nothing reaches the document while the card is pending.

## Approving a run

An agent in chat that holds the automation tools can ask to start one. The request arrives as a card naming the automation, and you can expand it to inspect the exact input it would run with before deciding. After approval the same card follows the live run — which node it is on, how long it has been going, and how it ended — and lets you stop it mid-flight or open the run itself for the full per-node detail.

<Note>

The chat holds while a request is pending, and it tells you so. Decide the card before sending the next message.

</Note>

## Answering a paused run

A run that needs a human answer takes the **Waiting** status in the [run list](/platform/automations/execution-logs) and parks there. The question arrives as a form card — fill it in and submit it, or push back in free text when the form is not asking the right thing. Answering does not restart anything: the run re-enters at the node it stopped on, carries your answer forward as that node's input, and finishes the rest of the graph. Every node it had already completed stays completed, so nothing it did before the pause happens twice.

## What each decision leaves behind

Every gate moves through the same handful of states on the card itself — pending, then being carried out, then finished or rejected — and the decision lands in the [audit log](/platform/admin/governance/audit-logs) with the actor and the timestamp. A resolved card cannot be reopened; to retry a rejected run, ask again and decide the fresh card. An approval that started a run leaves the run behind as its own record, so what the decision actually caused stays readable in the [run list](/platform/automations/execution-logs) long after the card is gone.

## Where this fits

These gates are the workflow-side face of one product-wide pattern: an agent proposes, a human disposes. [Approval concepts](/platform/approvals/concepts) names every card type beyond workflows — document writes, knowledge writes, connector calls — and [Configure approvals](/platform/approvals/configure) shows where the requirements are declared.
