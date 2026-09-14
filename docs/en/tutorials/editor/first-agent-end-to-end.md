---
title: Build your first agent
description: Create a project agent for a small text task, start it from the board, and review its result.
---

Build an agent that summarizes a contact message and recommends a next action. This exercise uses the task description as its input, so you can check the whole loop before adding connectors or shared knowledge: configure the agent, start one task, then review the result.

## Before you begin

You need a project you can edit, an available coding-agent harness with compatible model credentials, and a working sandbox allocation. An administrator manages [AI providers](/platform/admin/providers) and [Sandboxes](/platform/admin/sandboxes). A model that works in Chat is not enough by itself: the selected harness must be able to use its credential.

If the Agents page or model list is unavailable, resolve access or setup first. This tutorial does not require skills, connectors, platform tools, or injected secrets.

## Create the agent

Open the project's **Agents** tab and click **New agent**.

<Frame caption="The Agents table identifies each agent by its harness, provider, and model.">

![Website relaunch lists Content editor using Claude Code and Redirect auditor using Codex, with their provider and model beside the New agent button.](/images/platform/project-agents-models.webp)

</Frame>

1. Set **Name** to `Triage assistant`.
2. Choose an **Agent type** that your administrator has configured.
3. Under **Model**, search by model name or API ID and select the entry for the intended provider. The same model can appear from more than one provider.
4. Leave **Skills, connectors & tools** and **Secrets** empty for this exercise.
5. Paste the instructions below into **Instructions**, then click **Create agent**.

```text
Read the contact message in the task description. Return two lines:
Summary: one sentence explaining what the person needs.
Next action: reply, escalate, or close, followed by a short reason.
If the message has no usable request, say what information is missing.
Do not contact anyone or change records.
```

The new row is ready to be assigned a task. There is no separate publish step. Keep the agent's instructions about its recurring job; the individual message belongs in the task.

## Give it a task with a checkable answer

Open **Tasks**, create a task called `Triage the invoice-copy request`, and paste this into its description:

```text
Contact message:
“Hello, I received the order confirmation, but cannot find the invoice.
Could you send me a copy? The order number is A-1042.”

Acceptance criteria:
- Summarize the request in one sentence.
- Recommend reply, escalate, or close, with a reason.
- Do not say the invoice has already been sent.
```

Assign the task to `Triage assistant`. Open its details to set a **Reviewer** if someone else should review it; otherwise the task's creator receives the review request. Click **Start agent**. Assigning alone does not start work.

The task moves to **In progress**. A successful run posts its report as a comment and moves the task to **In review**. The sandbox and provider must be working for that run to complete.

## Review and improve the result

Read the agent's comment against the acceptance criteria. A suitable answer recognizes a request for an invoice copy and recommends replying; it must not claim an email was sent. Wording may vary by model.

Move the task to **Done** when you accept the result. If something is missing, mention the assigned agent in a task comment and give a specific correction, such as “Keep the summary to one sentence and explain why a reply is needed.” The follow-up continues the task conversation and returns a new result for review.

<Tip>

Change the task comment for a one-time correction. Edit the agent's instructions when the same rule should apply to its future tasks. Add tools only when a later exercise needs the agent to read or change something outside the supplied input.

</Tip>

## If the run cannot start or finish

A missing model calls for a provider and harness check. A sandbox error needs an administrator to check capacity and infrastructure. A failed task run stays visible for inspection; correct the cause before retrying. Avoid repeatedly starting the task while a run is already active.

[Task automation](/platform/projects/task-automation) explains retries, cancellation, reviewer handoff, and rework. [Project agents](/platform/projects/project-agents) covers the equipment you can add after this first task works.
