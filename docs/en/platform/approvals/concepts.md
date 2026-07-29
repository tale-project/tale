---
title: Approval concepts
description: An approval is a card in the chat that holds an agent's action until you decide. This page names what fires one, the decisions each card offers, and what every decision leaves behind.
---

An approval is the seam between an agent's initiative and your judgement: a card that appears in the chat where the action was attempted, holding that action until a person decides. Agents propose — a document write, an outbound API call, a workflow run — and nothing executes while the card is pending. The chat says so explicitly: **Respond to the pending request above to continue**.

This page is the mental model — what fires an approval, what the card offers, and what a decision leaves behind. The workflow-specific gates live on [Approvals in workflows](/platform/automations/approvals-in-workflows); where the requirements are declared lives on [Configure approvals](/platform/approvals/configure).

## What fires an approval

Every card comes from an agent trying to act on something that outlives the conversation:

- **Plans** — an agent proposes a multi-step plan as a **Proposed plan** card; **Approve & execute** starts it.
- **Document writes** — a **Save to documents** card holds files an agent wants to store; nothing lands in the document hub until approved.
- **Knowledge writes** — a **Save to knowledge base** card holds a fact an agent wants to remember org-wide.
- **Connector calls** — an operation flagged as requiring approval (outbound writes, typically) holds with the exact parameters shown.
- **MCP tools** — a tool the server marks **Requires approval** asks before it runs.
- **Workflow creation, updates, and runs** — the workflow-side gates, covered in [Approvals in workflows](/platform/automations/approvals-in-workflows).

## The decisions on a card

Every card carries the action's exact payload — the file, the fact, the parameters — and two decisions: approve (the button names the action, such as **Run workflow** or **Approve & execute**) or reject. Connector cards add a third path, **Suggest changes**: describe what is wrong in free text and the agent revises the call instead of abandoning it.

<Note>

Approvals are decided in the conversation they interrupt — by whoever holds that chat. There is no separate approval inbox or routing to an approver pool; the person the agent works for is the person who decides.

</Note>

## States and the trail

A card moves through **Pending** to **Executing** to **Completed** — or **Rejected** — and keeps its resolved state in the transcript, so a chat rereads as a record of what was allowed. Each decision also lands in the [audit log](/platform/admin/governance/audit-logs) with the actor, the action, and the timestamp. Resolved cards cannot be re-opened; a retry means a fresh proposal and a fresh card.

## Where this fits

Approvals are what let you hand agents real capabilities — files, APIs, workflows — without handing over the record of who allowed what. Read [Configure approvals](/platform/approvals/configure) next to see where a requirement is switched on, and [Approvals in workflows](/platform/automations/approvals-in-workflows) for the gates around workflows.
