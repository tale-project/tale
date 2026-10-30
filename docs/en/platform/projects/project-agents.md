---
title: Create and manage project agents
description: Configure an agent for a project's tasks, grant its equipment and start a task whose result you can review.
---

Create a project agent when you want a reusable configuration for that project’s tasks. It combines a coding runtime, a model, instructions and allowed equipment. Each task it works on runs in a [worker](#run-one-agent-on-several-tasks), a running copy of the agent in a sandbox of its own. You need project edit access; the project must be active. Members see the project's agents on its **Agents** tab, which tells them to ask an Editor or Admin for a new one. Until a project has agents of its own, its tasks can go to the organization's [standard agent](#standard-agent). Only Owners and Admins can change secret grants and the credentials an agent uses for [repository access](#repository-access).

## Prepare the first task

Choose a small outcome, such as reviewing a launch brief for missing approvals. The agent needs compatible [provider credentials](/platform/admin/providers) and an available [sandbox](/platform/admin/sandboxes). It can be configured without proving that a sandbox run will succeed.

Separate reusable instructions from the task. “Identify missing evidence and report the checks you performed” belongs on the agent. The document, review date and acceptance criteria belong on the task.

<Frame caption="The Agents tab — the project's own agents, each row naming its agent runtime, serving provider, and model.">

![The Agents tab of the Website relaunch project listing two named agents — Content editor on Claude Code and Redirect auditor on Codex — each row naming the serving provider and model id, beside a New agent button.](/images/platform/project-agents-models.webp)

</Frame>

## Configure the agent

<Steps>

<Step title="Name it and choose the runtime">

Open the project’s **Agents** tab and select **New agent**. Give it a recognizable **Name**, then choose **Agent runtime**, the [program that runs its session](/platform/agents/harnesses). Names are unique within the project; a project supports up to 50 agents.

Tale makes a mention handle from the name, which people type after `@` to find the agent: “My Opus Agent #3” becomes `@my-opus-agent-3`. If the handle is taken, by another agent of the project or by a member or an automation people already mention with it, the agent gets the next free one: `-02`, then `-03`. If a member or an automation comes to answer to the agent's handle later, the agent moves on to the next free one too. The handle appears on the **Agents** tab and under **Name** when you edit the agent. Renaming the agent changes its handle; mentions written earlier keep naming the agent and show its new name.

You can also start from a task: while the project has no agent, **Create an agent…** under **Assignee** opens **New agent** over the task and assigns the agent you create to it.

</Step>

<Step title="Choose the model and provider">

Search **Model** by name or API ID. The same model can appear once per provider; read the provider on the entry before selecting it. Selecting an entry pins that pair for future runs. Subscription entries appear only for a compatible runtime, and a model whose tool calls need OpenAI’s Responses API, such as GPT-6.1 Sol, appears only for Codex.

An older configuration may name a model without a pinned provider. The dialog reports which provider currently resolves it, or why none can serve it. Select an entry if you want to pin that choice.

</Step>

<Step title="Grant equipment and write instructions">

Under **Skills, connectors & tools**, add the bundles, services and platform operations the work needs. A new agent preselects the document skills `docx`, `pptx`, `xlsx` and `pdf` that are available to the project. They provide instructions for working with Word, PowerPoint, Excel and PDF files. Untick any the agent does not need; editing an existing agent keeps its saved equipment. Skill availability follows the project’s team access, not merely what you personally can see. A missing skill may therefore require a sharing change. After a sharing change, the list updates in every open **New agent** or edit dialog, including other people's sessions, without a reload. While the list is loading, the menu says so rather than showing no skills or connectors, and saving keeps the agent's equipment. If the list can't be loaded or refreshed, a notice under the menu says so and offers **Try again**.

<Frame caption="A new agent's Skills menu with the document skills already switched on; each skill names who created it.">

![The New agent dialog with its Skills menu open: docx, pdf, pptx, and xlsx are switched on and marked Built-in, while brief-summary and release-notes by Alex Rivera and visual-aspect-analyzer stay off.](/images/platform/project-agent-document-skills.webp)

</Frame>

The menu's search field narrows skills, connectors and tools as you type. **Search the knowledge base** is listed under **Knowledge** as always on: every agent searches the project's knowledge with no grant needed.

Read the **Writes data** label before granting a platform write tool: it authorizes real operations within that tool’s access rules. Connector broker actions available to agents are read-only; direct GitHub tooling or explicit secrets use separate access paths.

**Change task priority and agent assignment** lets a project agent prioritize existing tasks, assign them to an agent of the same project (or one a dispatch serving that project puts to work there) or leave them unassigned, without starting work. It is off until you grant it and is unavailable to automation agent nodes. The agent must read each task first and submit the current values with its changes; if someone changed those values meanwhile, the whole request is refused and the agent must read again. Ownership changes require an open task with no live run, pending review, or open question. A priority change alone preserves those handoffs. The tool never changes the status or reviewer, answers a human question, or starts a run. Only a live run with project-wide authority can use it; a run a Member started cannot.

**Review other agents’ task results** lets a designated reviewer decide a completed result from a different project agent. It is off until you grant it and is unavailable to automation agent nodes. Selecting an agent as reviewer does not enable this tool or start a run. The reviewer works from its own task, with current project-wide authority and the review permission still enabled. A decision records feedback and evidence; approval completes the reviewed task, while a request for changes returns it to **To do** without starting more work. Required human competences and workflow approvals remain protected. [Set up an independent reviewer](/platform/projects/task-automation#agent-review) explains the full flow.

**Start other agents on tasks** lets the agent put another agent of this project to work, for example a manager agent that hands out ready work and resumes an agent whose question it answered. It names a task, optionally the agent to assign it to, and a message the started run addresses first. The started run answers to whoever the manager's run answers to and names the manager as the agent that started it. An agent started this way cannot start further agents, a run a Member started cannot start any, a manager cannot start itself on another task, and a task an open task blocks is not started. An agent already working other tasks is started all the same: its run takes a [worker](#run-one-agent-on-several-tasks) of its own, or waits for one, and the answer says why it waits. Grant this tool only to an agent whose instructions say which work it may hand out; [Task automation](/platform/projects/task-automation#work-an-automation-or-another-agent-starts) describes what such a run may do.

**Add and edit knowledge entries** lets the agent save facts as [knowledge entries](/platform/knowledge/knowledge-entries#let-an-agent-keep-facts-current) of the whole organization, one per topic. To change an entry, it must name the version it read; if the entry changed since, nothing is saved and the agent merges its change into the current text. It cannot delete entries, and a run a Member started cannot save any. Grant it to an agent whose instructions say which facts are worth keeping.

A run’s connector calls act for the member who started it, whether with **Start agent**, **Retry**, a move to **In progress** or an @mention of the agent. They use the organization’s [connector credentials](/platform/admin/connectors) and are recorded under that member. If that member leaves the organization or is disabled, the calls are refused: use **Cancel run** (or let the run finish), then start it again so it acts for you. When a comment restarts the run to guide it, as every runtime except Claude Code does, the calls act for the comment's author from then on.

Write **Instructions** that define responsibility, evidence and boundaries. For the launch reviewer: “Read the supplied brief. Report missing approvals and conflicting dates with the source passage. Do not mark the task complete.”

</Step>

<Step title="Review and save">

If the work needs **Secrets**, an Owner or Admin grants named organization credentials. The running agent can read their values, so use narrowly scoped, replaceable tokens. Shared names affect other agents and workflow nodes when their underlying value changes. A run a Member starts gets none of these secrets, nor the Git access of an equipped GitHub or Forgejo connection: an Editor or higher has to start work that needs them.

For a private repository, give the agent [its own repository access](#repository-access) through the GitHub or Forgejo connector, or use a key restricted to that repository, and state the allowed Git operations in the agent's instructions. Commits carry the agent's **Commit identity**. Keep SSH host verification enabled; a self-hosted sandbox routes repository SSH through its existing proxy as described in [SSH repository access](/self-hosted/configuration/environment-reference#ssh-repository-access).

Select **Create agent**. Check the new row’s runtime, provider and model, then reopen it if you need to inspect the saved equipment or instructions.

</Step>

</Steps>

## Give the agent its own repository access {#repository-access}

An agent equipped with the GitHub or Forgejo connector can clone, fetch and push over HTTPS in its sandbox with one of the organization's [connector credentials](/platform/admin/connectors): a GitHub credential opens `github.com`, a Forgejo credential the host of its instance address. Unless you choose otherwise, the agent uses the connector's default credential.

To give agents different reach, store one credential per scope under **Settings > Connectors**, each limited to its repositories in GitHub or Forgejo. For example, a central Coder gets a credential that reaches every repository of the organization, and each client's Coder one that reaches that client's repository alone. Then edit the agent, and under **Repository access** choose the credential for each connector. Only Owners and Admins can change this choice.

- A credential you choose is the only one the agent uses for that connector. If it is deleted later, the agent's runs get no access through that connector until someone chooses another. They never fall back to the default.
- The agent's Git answers only the hosts of the connectors it is equipped with. A token in a secret, such as `GITHUB_TOKEN`, does not sign Git in.
- The token reaches only the running turn. Tale never writes it into the workspace or a log, and records every time a turn receives it.
- A run a Member starts, and a run on another project's board whose starter may not use the agent's full equipment, gets none of these credentials, nor any of the agent's secrets. It still commits under the agent's **Commit identity**.
- The agent's connector actions from its sandbox, such as listing Forgejo repositories, act as the same credential in every run of the agent, a Member's included. Those calls run in Tale and never hand the credential to the sandbox. If the chosen credential is gone, they fail.
- Only GitHub and Forgejo take this choice, the connectors whose credentials open Git remotes.

Under **Commit identity**, set the name and email the agent's commits carry. An agent's workers belong to no person, so every run of it commits under this identity, whoever or whatever started it: a person, the [dispatch](/platform/projects/dispatch), a standing role or a schedule. Without one, Git has no author configured, and the agent must set one before it commits.

Through the [REST API](/develop/api-reference#manage-a-projects-agents), the same settings are `connectorCredentials` and `gitIdentity`; a [CLI declaration](/self-hosted/install/cli-install) sets them on `project-agent`.

## Assign and start work

Open a task in the same project, choose the agent as assignee and select **Start agent**. An agent of another project can also take the task while that project's [dispatch serves this board](/platform/projects/dispatch#sources). Assignment and execution are separate actions. Provide the files and acceptance criteria before starting. You don't need project edit access for this: a Member can put an agent to work on a task they created or that is assigned to them, and an Editor or higher on any task in the project. A run a Member starts keeps to that task, without the agent's secrets and in a workspace of its own; [Agent runs a Member starts](/platform/projects/tasks#agent-runs-a-member-starts) lists what changes.

The agent's report appears in task comments and collected files appear as deliverables. When an admin has turned on [image generation](/platform/admin/governance/content-models#let-agents-generate-images), the agent can also create images for the task; they appear among the deliverables and count against the member who started the run. Successful agent work moves to **In review** for its designated human or independent agent reviewer. Mention the agent in a comment to guide a running task or continue the conversation; the chosen agent runtime determines whether guidance enters the existing process or starts a continuation.

[Task automation](/platform/projects/task-automation) explains progress, stopping and review. The ordinary Chat assistant remains separate, even when a chat has project context.

## Read the current execution {#current-execution}

On a task-agent turn, call the separate `workspace_status` tool with `{}` to read fresh execution identity. For a live turn, the platform checks the token’s organization, session and exec against the current task run and returns `currentExecution`: `taskId`, `agentId`, `runId`, `execId`, `startedAt`, `launchedAt` and the server’s `observedAt`. Times are epoch milliseconds; `launchedAt` can be `null` while the run is queued.

A superseded or ended turn has no current identity. `null`, an absent field or a failed read means unknown; do not copy identity from earlier guidance or a saved receipt. Ordinary chat, workflow and older platform responses can omit this field. Expired authentication stays refused. The tool listing and grants stay unchanged, and discovery needs no additional tool grant. This observation does not authorize a start, command or publication.

## Run one agent on several tasks

An agent is a configuration; a worker is one running copy of it. Each task the agent works on at the same time runs in a worker of its own: a sandbox with its own workspace, memory and processes, so two tasks never share files or slow each other down. Start the agent Scribe on “Release notes” and on “Changelog”, and both work at once, one per worker. The one exception is the [standard agent](#standard-agent-runs) when a person starts it: it works the task without a worker until the work needs one.

Workers count against your organization’s **Agent workers** limit in [Sandboxes](/platform/admin/sandboxes#identify-the-limit-that-matters), which every agent of the organization shares. When all of them are busy, a new run waits instead of failing, and the task says why under **Run**: **Waiting for a worker**. It starts on its own as soon as a worker is free, without using an automatic retry, and gets its full working time from then on. Owners and Admins see a link there to raise the limit. When several runs wait, a freed worker goes first to the agent with the fewest runs working, then to the run that has waited longest. To take a waiting run back, use **Cancel run**, or assign the task to someone else: a run that has not started yet is cancelled with the reassignment. A project's [dispatch](/platform/projects/dispatch#limits) can keep one agent on up to 500 tasks at once; how many of them work at the same time is still decided by this limit.

A task’s next run goes back to the worker it last worked in when that worker is free, so the agent continues the conversation and finds its files there. If that worker is busy, the run takes another one and starts fresh from the task’s description, discussion, attachments and deliverables. The same goes when the deployment refuses to start that worker, for example because the server is full: the run takes another worker of the agent that can start, such as one on a [connected device](/platform/admin/sandbox-devices) with room, and the worker it was refused in keeps its files for later runs. When none can start, the run waits for that worker. After a run fails or is cancelled, its worker stays reserved for that task for 15 minutes, so a retry finds what the run left; another task’s run takes it only when no other worker is free.

## Share the sandbox host during heavy work {#heavy-phases}

Agent workers of every organization share the deployment's sandbox host, and a few phases of work press it hardest: installing dependencies, building an image, type-checking or linting a whole workspace, running a full test suite. Before such a phase, an agent working a task asks the host for a lease. Every task run on a runtime with Tale's MCP channel can, without a tool grant: Tale names the tools in the agent's instructions. The agent calls `host_lease_acquire` with what the phase is (`label`) and, when it can tell, how much it will write to disk, how much memory it needs and how many minutes it takes. The answer decides what happens next:

- **Granted**: the agent runs the phase, then releases the lease with `host_lease_release`, so the next agent's phase can start.
- **Refused**: the host is under pressure, already runs as many heavy phases as it allows at once, or would run short of disk or memory beside them. The answer names the reason and how many seconds to wait. The agent waits, then asks again instead of running the phase.
- **Unavailable**: the host cannot be judged, for example sandboxes on Kubernetes, Incus or a remote Docker daemon, or an older sandbox service. Leases do not exist there, and the agent runs the phase without one.

A run holds one lease at a time. Every lease it still holds ends when the run ends, whether it settles, fails or is cancelled; a lease also ends by itself at its expiry, two hours after it was granted at most. A run that waits for a lease is still working, so the wait counts toward its working time. A command that touches one package or one test file needs no lease. Operators set how many heavy phases run at once and how much disk they must leave free; see [Heavy-phase leases](/self-hosted/configuration/environment-reference#heavy-phase-leases).

## The standard agent {#standard-agent}

A project without agents of its own can still take on agent work. Unless an admin has turned it off under [Governance > Models](/platform/admin/governance/content-models#standard-agent), **Assignee** offers **Standard agent** there, to everyone who can assign the task, Members included. The first time someone chooses it, Tale sets the agent up in the project and assigns it the task. You then start it like any other agent, or mention it in a comment. When it can't start for you, the comment box says so, and your comment is saved as a plain mention.

<Frame caption="The Agents tab of a project whose tasks go to the standard agent.">

![The Agents tab of the Customer onboarding portal project with one row, Standard agent, marked Standard, reading Claude Code · OpenRouter · anthropic/claude-haiku-4.5 · 4 equipped and Set up by Tale for this project. Its agent runtime, model and instructions follow the organization's settings under Governance. The row has a delete button and no edit button.](/images/platform/project-agents-standard.webp)

</Frame>

The **Agents** tab lists it with the **Standard** badge. Nobody edits it: its agent runtime, model and instructions follow the organization's settings, read again whenever a run starts, and its equipment is whichever of the document skills `docx`, `pptx`, `xlsx` and `pdf` the project can use when a run starts, so a skill an admin turns off drops out instead of stopping the agent. On **Automatic**, each run uses a model that the person who starts it may use, so it can run on different models for different people.

To give the project an agent of its own, select **New agent**. From then on, the project isn't offered the standard agent any more; the one already set up stays assignable until you delete it. Deleting it keeps the history of its tasks, and while the project has no agents, the next task given to the standard agent sets it up again.

### How a standard agent run works {#standard-agent-runs}

When a person starts the standard agent, it works the task the way the [chat assistant](/platform/chat/files-and-skills) makes a file: with the model chosen for that person, the same knowledge search and page fetching a chat has, the document skills it is equipped with, and code run in a [light sandbox](/platform/admin/sandboxes#light-sandboxes) that starts in about a second and goes away when the run ends. A person starts it with **Start agent**, with an @mention in a comment or in the description, or through the API. No worker starts for such a run, so it never waits for one and doesn't count against **Agent workers**: **Run** reads **Working…** as soon as it starts. It ends like any run. The closing message is posted as the report, the files it made are the task's deliverables, and the task moves to **In review**. **View** on the run in the task's history lists what it did, tool by tool.

The run is booked like a chat reply: to the person who started it, under the agent, and on the project. A limit that binds that person refuses the run before it spends anything, and the task then says a usage limit stopped it. An organization works at most four such runs at once; the next waits its turn and starts when one of them ends. A run stops after about 50 minutes, and a Member's run reads only what that Member can read.

When the work needs more than a light sandbox offers, such as a repository to clone and test, a browser session or hours of processing, the agent hands the task to its full workspace instead. It writes down why and what remains. A worker of the agent then starts and carries on from that brief, and the files already made are among the task's deliverables, so nothing is redone. **Run** reads **Waiting for a worker** or **Working…** again. If that worker can't start and the run is retried, the retry goes straight to the full workspace with the same brief.

A run without a worker takes no word while it works. Mention the agent in a comment, or in the description, and the run stops and a new one starts with your comment as its message; if the organization refuses that start, the first run goes on. **Cancel run** ends it at once.

Everything else works in a worker from the start: a run an automation, a schedule or another agent starts, a standard agent whose agent runtime an admin chose under [Governance > Models](/platform/admin/governance/content-models#standard-agent), one whose model only a runtime can serve, such as a subscription's, and every agent you create yourself.

## Update or remove an agent

When you edit an existing agent, saving checks that its settings have not changed since you opened it. If someone else saved first, your save is refused and your unsaved edits stay in the dialog. Copy the changes you want to keep before closing it, then reopen the agent to load the latest settings and merge your changes before saving again.

Use the agent’s row actions to edit or delete it. The standard agent has only **Delete agent**. Changes apply to later runs; an active run keeps its starting configuration. Deleting the agent clears task assignment references while preserving task history. It also deletes the [workspaces of all its workers](/platform/admin/sandboxes#explain-why-a-workspace-disappeared) and their files, including each Member's. Review current work and preserve outputs you still need before removing the agent.

If creation fails, use the displayed reason to distinguish a duplicate name, missing project access, an unavailable provider/model or a skill visibility issue. A run that fails for good says at the top of its task what went wrong and who can fix it; [When the agent can't finish](/platform/projects/task-automation#when-the-agent-cant-finish) lists the cases. Changing instructions does not fix those dependencies.
