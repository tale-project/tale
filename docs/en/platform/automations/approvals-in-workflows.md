---
title: Approvals in workflows
description: Where a live run waits on a person — a connector write parked for approval, a question an agent node asks — and how a definition changes and goes live without a proposal card.
---

Automations run without you, but a run stops for you in two places. A connector write that leaves your tenant parks until someone approves it, and an agent node that needs an answer parks until someone gives one; both wait on the run's detail page, and both resume exactly where they stopped. Changing the definition itself has no card in this version: you edit and save versions on the canvas, and deploying is a separate, explicit act. This page covers the two gates and the authoring path; what an approval is in general lives on [Approval concepts](/platform/approvals/concepts).

<Frame caption="An automation's canvas with its side panel — the definition changes here by saving a version, and a live run parks on its detail page when a step needs a person.">

![The workflow canvas of an automation showing a graph of nodes, with a panel open beside it.](/images/platform/automation-editor-canvas.webp)

</Frame>

## Approving a connector write

When a live run reaches a write your policy gates, the run takes the **Waiting** status in the [run list](/platform/automations/execution-logs) and its detail page shows the approval card: **Waiting for your approval**, the operation as `<connector>.<action>`, the node that requested it, and the exact input under **The step would call with**. **Approve** lets the step act on the run's next poll and the run carries on; **Reject** fails the step and the run stops. Test runs never park here — in mock mode nothing outside the platform is touched. Which writes ask, and how to move the line, is on [Configure approvals](/platform/approvals/configure).

## Answering a paused run

An agent node that cannot finish without you asks: the run parks as **Waiting** and its detail page shows the question — as a set of choices when the agent offered some, as a free-text box otherwise. Answer it and the run re-enters at the node it stopped on with your answer in hand, then finishes the rest of the graph; nothing a completed node did happens twice. The agent asks through its `ask_human` tool, which every automation agent node carries, so the pause is the agent's decision rather than a node you place.

## Changing and deploying a definition

There is no proposal card between you and the definition in this version — no AI editor on the canvas, no chat agent that drafts a change for you to approve. You change a definition by editing nodes on the canvas and clicking **Save**, which appends a version with your message and leaves every earlier version as it was; **Test run** exercises it against mocks; and nothing runs live until you click **Deploy this version**, which the automation's own tests gate. A model authoring an automation goes through the [MCP endpoint](/develop/mcp-endpoint) — `save_automation` appends a version the same way, and `deploy_automation` is the same explicit step. [The workflow editor](/platform/automations/editor) walks the three acts.

## What each decision leaves behind

Both gates leave a record in two places: the run's own detail, where the card settles to approved or rejected and the step's result follows, and the [audit log](/platform/admin/governance/audit-logs), which records who decided and when. A decided card cannot be reopened; a rejected run is over, and running the automation again is a fresh run with a fresh card. Because a decision belongs to the operation it was asked about, a policy loosened afterwards never releases a card already waiting.

## Where this fits

A run waits on a person for two reasons — a write that leaves the tenant, and a question only a person can answer — and both waits sit on the run's detail page rather than in a chat. [Approval concepts](/platform/approvals/concepts) is the model behind the write gate, [Configure approvals](/platform/approvals/configure) moves the line, and [Execution logs](/platform/automations/execution-logs) is where you find the waiting run in the first place.
