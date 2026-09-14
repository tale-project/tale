---
title: Respond to a waiting workflow
description: Find a paused automation run, review a proposed write, or answer an agent’s question so the run can continue.
---

A run can wait for a decision before writing through a connector, or for information an agent needs to continue. Open the run detail to see which response is required. A waiting run has not finished, even if earlier nodes succeeded.

## Find the waiting run

Open the automation and its [execution logs](/platform/automations/execution-logs), then select the run marked **Waiting**. Check the version and run input so you know which execution you are reviewing.

An operation approval names a connector action and shows its proposed input. An agent question instead asks for an answer, with choices or a text field. These are separate interactions: answering a question does not approve a later write.

## Approve or reject a write

Read the operation and **The step would call with** carefully. Check the recipient or destination, the content, and any identifier that selects what will change.

Choose **Approve** to allow the operation. The run resumes and attempts the write; check the node result and effects afterwards. Choose **Reject** if the request is wrong or should not happen. Rejection prevents that operation and fails the run.

You cannot revise parameters on the approval card. Reject an incorrect request, fix the workflow or run input, and test the correction before starting a new live run. Changes to the approval policy do not release an already pending card. See [Approval concepts](/platform/approvals/concepts) for the decision lifecycle and [approval policy configuration](/self-hosted/configuration/approvals) for operator rules.

## Answer an agent’s question

When an agent node uses `ask_human`, the run detail displays **The agent needs your answer to continue**. If choices are offered, answer the questions on the card. For an open question, enter text under **Your answer**, then choose **Send answer & resume**.

Give the missing information directly. If the agent asks which document to use, name the document or provide its identifier rather than a general instruction to continue. The waiting node resumes with your answer, and the run may later need another answer or an operation approval. Organization members can answer these questions.

## Correct and test the workflow

Changing a workflow definition is separate from responding to its current run. Save a corrected version in the [workflow editor](/platform/automations/editor), test it against mocks, then deploy it when it is ready for live use. Saving a version does not revise a call already waiting for approval.

<Frame caption="Edit the workflow on the canvas; review a waiting execution on its run detail page.">

![The workflow editor shows the automation graph and a panel for configuring a selected node.](/images/platform/automation-editor-canvas.webp)

</Frame>

A mock test does not perform external connector writes or request their live approvals. For a practical walkthrough, follow [Build a workflow with approvals](/tutorials/editor/workflow-with-approvals). After a live decision, inspect both the run outcome and the [audit log](/platform/admin/governance/audit-logs); permission to proceed and successful execution are different results.
