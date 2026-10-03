---
title: Create and manage project agents
description: Configure a reusable worker, grant its equipment and start a task whose result you can review.
---

Create a project agent when you want a reusable worker for that project’s tasks. It combines a coding runtime, a model, instructions and allowed equipment. You need project edit access; the project must be active. Members see the project's agents on its **Agents** tab, which tells them to ask an Editor or Admin for a new one. Until a project has agents of its own, its tasks can go to the organization's [standard agent](#standard-agent). Only Owners and Admins can change secret grants.

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

You can also start from a task: while the project has no agent, **Create an agent…** under **Assignee** opens **New agent** over the task and assigns the agent you create to it.

</Step>

<Step title="Choose the model and provider">

Search **Model** by name or API ID. The same model can appear once per provider; read the provider on the entry before selecting it. Selecting an entry pins that pair for future runs. Subscription entries appear only for a compatible runtime.

An older configuration may name a model without a pinned provider. The dialog reports which provider currently resolves it, or why none can serve it. Select an entry if you want to pin that choice.

</Step>

<Step title="Grant equipment and write instructions">

Under **Skills, connectors & tools**, add the bundles, services and platform operations the work needs. A new agent preselects the document skills `docx`, `pptx`, `xlsx` and `pdf` that are available to the project. They provide instructions for working with Word, PowerPoint, Excel and PDF files. Untick any the agent does not need; editing an existing agent keeps its saved equipment. Skill availability follows the project’s team access, not merely what you personally can see. A missing skill may therefore require a sharing change.

<Frame caption="A new agent's Skills menu with the document skills already switched on; each skill names who created it.">

![The New agent dialog with its Skills menu open: docx, pdf, pptx, and xlsx are switched on and marked Built-in, while brief-summary and release-notes by Alex Rivera and visual-aspect-analyzer stay off.](/images/platform/project-agent-document-skills.webp)

</Frame>

Read the **Writes data** label before granting a platform write tool: it authorizes real operations within that tool’s access rules. Connector broker actions available to agents are read-only; direct GitHub tooling or explicit secrets use separate access paths.

**Change task priority and agent assignment** lets a project agent prioritize existing tasks, assign them to an agent of the same project or leave them unassigned, without starting work. It is off until you grant it and is unavailable to automation agent nodes. The agent must read each task first and submit the current values with its changes; if someone changed those values meanwhile, the whole request is refused and the agent must read again. Ownership changes require an open task with no live run, pending review, or open question. A priority change alone preserves those handoffs. The tool never changes the status or reviewer, answers a human question, or starts a run. Only a live run with project-wide authority can use it; a run a Member started cannot.

**Review other agents’ task results** lets a designated reviewer decide a completed result from a different project agent. It is off until you grant it and is unavailable to automation agent nodes. Selecting an agent as reviewer does not enable this tool or start a run. The reviewer works from its own task, with current project-wide authority and the review permission still enabled. A decision records feedback and evidence; approval completes the reviewed task, while a request for changes returns it to **To do** without starting more work. Required human competences and workflow approvals remain protected. [Set up an independent reviewer](/platform/projects/task-automation#agent-review) explains the full flow.

**Start other agents on tasks** lets the agent put another agent of this project to work, for example a manager agent that hands out ready work and resumes an agent whose question it answered. It names a task, optionally the agent to assign it to, and a message the started run addresses first. The started run answers to whoever the manager's run answers to and names the manager as the agent that started it. An agent started this way cannot start further agents, a run a Member started cannot start any, and an agent already working another task, or a task an open task blocks, is not started. Grant this tool only to an agent whose instructions say which work it may hand out; [Task automation](/platform/projects/task-automation#work-an-automation-or-another-agent-starts) describes what such a run may do.

A run’s connector calls act for the member who started it, whether with **Start agent**, **Retry**, a move to **In progress** or an @mention of the agent. They use the organization’s [connector credentials](/platform/admin/connectors) and are recorded under that member. If that member leaves the organization or is disabled, the calls are refused: use **Cancel run** (or let the run finish), then start it again so it acts for you. When a comment restarts the run to guide it, as every runtime except Claude Code does, the calls act for the comment's author from then on.

Write **Instructions** that define responsibility, evidence and boundaries. For the launch reviewer: “Read the supplied brief. Report missing approvals and conflicting dates with the source passage. Do not mark the task complete.”

</Step>

<Step title="Review and save">

If the work needs **Secrets**, an Owner or Admin grants named organization credentials. The running agent can read their values, so use narrowly scoped, replaceable tokens. Shared names affect other agents and workflow nodes when their underlying value changes. A run a Member starts gets none of these secrets, nor the token of an equipped GitHub connection: an Editor or higher has to start work that needs them.

Select **Create agent**. Check the new row’s runtime, provider and model, then reopen it if you need to inspect the saved equipment or instructions.

</Step>

</Steps>

## Assign and start work

Open a task in the same project, choose the agent as assignee and select **Start agent**. Assignment and execution are separate actions. Provide the files and acceptance criteria before starting. You don't need project edit access for this: a Member can put an agent to work on a task they created or that is assigned to them, and an Editor or higher on any task in the project. A run a Member starts keeps to that task, without the agent's secrets and in a workspace of its own; [Agent runs a Member starts](/platform/projects/tasks#agent-runs-a-member-starts) lists what changes.

The agent's report appears in task comments and collected files appear as deliverables. When an admin has turned on [image generation](/platform/admin/governance/content-models#let-agents-generate-images), the agent can also create images for the task; they appear among the deliverables and count against the member who started the run. Successful agent work moves to **In review** for its designated human or independent agent reviewer. Mention the agent in a comment to guide a running task or continue the conversation; the chosen harness determines whether guidance enters the existing process or starts a continuation.

[Task automation](/platform/projects/task-automation) explains progress, stopping and review. The ordinary Chat assistant remains separate, even when a chat has project context.

## The standard agent {#standard-agent}

A project without agents of its own can still take on agent work. Unless an admin has turned it off under [Governance > Models](/platform/admin/governance/content-models#standard-agent), **Assignee** offers **Standard agent** there, to everyone who can assign the task, Members included. The first time someone chooses it, Tale sets the agent up in the project and assigns it the task. You then start it like any other agent, or mention it in a comment. When it can't start for you, the comment box says so, and your comment is saved as a plain mention.

<Frame caption="The Agents tab of a project whose tasks go to the standard agent.">

![The Agents tab of the Customer onboarding portal project with one row, Standard agent, marked Standard, reading Claude Code · OpenRouter · anthropic/claude-haiku-4.5 · 4 equipped and Set up by Tale for this project. Its agent type, model and instructions follow the organization's settings under Governance. The row has a delete button and no edit button.](/images/platform/project-agents-standard.webp)

</Frame>

The **Agents** tab lists it with the **Standard** badge. Nobody edits it: its agent type, model and instructions follow the organization's settings, read again whenever a run starts, and its equipment is whichever of the document skills `docx`, `pptx`, `xlsx` and `pdf` the project can use when a run starts, so a skill an admin turns off drops out instead of stopping the agent. On **Automatic**, each run uses a model that the person who starts it may use, so it can run on different models for different people.

To give the project an agent of its own, select **New agent**. From then on, the project isn't offered the standard agent any more; the one already set up stays assignable until you delete it. Deleting it keeps the history of its tasks, and while the project has no agents, the next task given to the standard agent sets it up again.

## Update or remove an agent

Use the agent’s row actions to edit or delete it. The standard agent has only **Delete agent**. Changes apply to later runs; an active run keeps its starting configuration. Deleting the agent clears task assignment references while preserving task history. It also deletes the agent's [sandbox workspaces](/platform/admin/sandboxes#explain-why-a-workspace-disappeared) and their files, including each Member's. Review current work and preserve outputs you still need before removing the worker it belongs to.

If creation fails, use the displayed reason to distinguish a duplicate name, missing project access, an unavailable provider/model or a skill visibility issue. A run that fails for good says at the top of its task what went wrong and who can fix it; [When the agent can't finish](/platform/projects/task-automation#when-the-agent-cant-finish) lists the cases. Changing instructions does not fix those dependencies.
