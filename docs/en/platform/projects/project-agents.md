---
title: Create and manage project agents
description: Configure a reusable worker, grant its equipment and start a task whose result you can review.
---

Create a project agent when you want a reusable worker for that project’s tasks. It combines a coding runtime, a model, instructions and allowed equipment. You need project edit access; the project must be active. Only Owners and Admins can change secret grants.

## Prepare the first task

Choose a small outcome, such as reviewing a launch brief for missing approvals. The agent needs compatible [provider credentials](/platform/admin/providers) and an available [sandbox](/platform/admin/sandboxes). It can be configured without proving that a sandbox run will succeed.

Separate reusable instructions from the task. “Identify missing evidence and report the checks you performed” belongs on the agent. The document, review date and acceptance criteria belong on the task.

<Frame caption="The Agents tab — the project's own agents, each row naming its harness, serving provider, and model.">

![The Agents tab of the Website relaunch project listing two named agents — Content editor on Claude Code and Redirect auditor on Codex — each row naming the serving provider and model id, beside a New agent button.](/images/platform/project-agents-models.webp)

</Frame>

## Configure the agent

<Steps>

<Step title="Name it and choose the runtime">

Open the project’s **Agents** tab and select **New agent**. Give it a recognizable **Name**, then choose **Agent type**, the coding [harness](/platform/agents/harnesses). Names are unique within the project; a project supports up to 50 agents.

</Step>

<Step title="Choose the model and provider">

Search **Model** by name or API ID. The same model can appear once per provider; read the provider on the entry before selecting it. Selecting an entry pins that pair for future runs. Subscription entries appear only for a compatible runtime.

An older configuration may name a model without a pinned provider. The dialog reports which provider currently resolves it, or why none can serve it. Select an entry if you want to pin that choice.

</Step>

<Step title="Grant equipment and write instructions">

Under **Skills, connectors & tools**, add the bundles, services and platform operations the work needs. Skill availability follows the project’s team access, not merely what you personally can see. A missing skill may therefore require a sharing change.

Read the **Writes data** label before granting a platform write tool: it authorizes real operations within that tool’s access rules. Connector broker actions available to agents are read-only; direct GitHub tooling or explicit secrets use separate access paths.

Write **Instructions** that define responsibility, evidence and boundaries. For the launch reviewer: “Read the supplied brief. Report missing approvals and conflicting dates with the source passage. Do not mark the task complete.”

</Step>

<Step title="Review and save">

If the work needs **Secrets**, an Owner or Admin grants named organization credentials. The running agent can read their values, so use narrowly scoped, replaceable tokens. Shared names affect other agents and workflow nodes when their underlying value changes.

Select **Create agent**. Check the new row’s runtime, provider and model, then reopen it if you need to inspect the saved equipment or instructions.

</Step>

</Steps>

## Assign and start work

Open a task in the same project, choose the agent as assignee and select **Start agent**. Assignment and execution are separate actions. Provide the files and acceptance criteria before starting.

The agent’s report appears in task comments and collected files appear as deliverables. Successful agent work moves to **In review** for a person’s judgment. Mention the agent in a comment to guide a running task or continue the conversation; the chosen harness determines whether guidance enters the existing process or starts a continuation.

[Task automation](/platform/projects/task-automation) explains progress, stopping and review. The ordinary Chat assistant remains separate, even when a chat has project context.

## Update or remove an agent

Use the agent’s row actions to edit or delete it. Changes apply to later runs; an active run keeps its starting configuration. Deleting the agent clears task assignment references while preserving task history. Review current work before removing the worker it belongs to.

If creation or execution fails, use the displayed reason to distinguish a duplicate name, missing project access, an unavailable provider/model, a skill visibility issue or unavailable sandbox capacity. Changing instructions does not fix those dependencies.
