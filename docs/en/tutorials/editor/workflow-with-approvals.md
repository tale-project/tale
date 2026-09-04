---
title: Build a workflow with an approval
description: The AI editor and its proposal card are not part of this version — a workflow with a human decision is built on the canvas, and the run waits for that decision on its detail page.
---

This tutorial used to toggle an **AI editor** on the canvas toolbar, describe a three-step workflow in one message, approve the proposal card it answered with, and then answer the paused run. The AI editor does not exist in this version of Tale — the canvas has no assistant panel, and no card proposes a definition for you to approve. The human decision in the middle of a run is very much there; it comes from the run itself, not from a card in an editor.

<Note>

The AI editor is not available in this version. You build the definition on the canvas and save it as a version yourself, or let a model author it through the [MCP endpoint](/develop/mcp-endpoint); a person still decides the outbound step at run time.

</Note>

## Put a person between the draft and the send today

Build the shape by hand on the canvas: an **agent** node that drafts the summary, then a connector node that sends it. Nothing extra is needed for the decision — a connector write that leaves your tenant, such as sending mail or posting to a channel, parks the live run on its own. The run shows **Waiting** in the run list, its detail page shows **Waiting for your approval** with the exact message the step would send, and **Approve** releases it while **Reject** stops the run. A schedule on the automation's own page runs it every weekday morning, and **Test run** exercises the graph against mocks without sending anything. [The workflow editor](/platform/automations/editor) walks the canvas, saving, and deploying; [Automation triggers](/platform/automations/triggers) covers the schedule.

When the decision should be about the draft rather than the send, let the agent ask: an automation agent node carries an `ask_human` tool, and a run that calls it parks as **Waiting** with the question on its detail page until you answer, then resumes at that node with your answer. [Approvals in workflows](/platform/automations/approvals-in-workflows) covers both gates.

## Where this fits

The shape this tutorial promised — draft, decide, act — is the shape a run takes on its own in this version: the outbound write asks, a person reads the exact call, and the record says who allowed it. [Automation concepts](/platform/automations/concepts) is the vocabulary behind definition, trigger, and run; [Approval concepts](/platform/approvals/concepts) is the model behind the wait.
