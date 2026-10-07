---
title: Projects
description: Bring a team's reference material, conversations, and tasks together around a shared piece of work.
---

A project keeps the files, instructions, conversations, and tasks for one piece of work together. Use one when context needs to last beyond a single chat or when a result needs an owner and a review. Start with [Use projects](/tutorials/member/use-projects) to create a project and ask a question about its reference file.

<Video src="/videos/en/tutorials/ep6-projects/ep6-projects.en.mp4" poster="/videos/en/tutorials/ep6-projects/ep6-projects.en.webp" captions="/videos/en/tutorials/ep6-projects/ep6-projects.en.vtt" lang="en" title="Episode 6 — Projects with AI" caption="Episode 6 — Projects with AI (2:21)">

</Video>

<Frame caption="The task board makes proposed work, work in progress, and results awaiting review visible together.">

![Website relaunch shows task cards across Backlog, To do, In progress, In review, Done, and Cancelled.](/images/platform/projects-task-board.webp)

</Frame>

## Find the next step

<CardGroup cols="2">

<Card title="Understand project access" icon="compass" href="/platform/projects/concepts">
Learn what the project shares, which chats stay personal, and how teams control access.
</Card>

<Card title="Manage reference files" icon="folder-open" href="/platform/projects/manage-files">
Upload and organize files, check indexing, and manage controlled revisions.
</Card>

<Card title="Create and track tasks" icon="list-checks" href="/platform/projects/tasks">
Set an owner, reviewer, dates, and acceptance criteria; follow progress on the board.
</Card>

<Card title="Configure a project agent" icon="bot" href="/platform/projects/project-agents">
Choose an agent runtime, model, tools, and instructions for an agent that can take tasks.
</Card>

<Card title="Run and review agent work" icon="workflow" href="/platform/projects/task-automation">
Start a task, review the result, request rework, and recover a failed run.
</Card>

<Card title="Triage proposed work" icon="gauge" href="/platform/projects/backlog">
Use Backlog to review ideas before committing them to the team's work.
</Card>

</CardGroup>

Every project you can open is listed under **Projects** in [Home](/platform#home), where **All projects** opens the full list. A project opens on its task board; **General**, **Chats**, **Knowledge**, and **Agents** sit beside the task views. For Owners, Admins, and Developers, a bound automation adds an **Automations** surface; project administrators can configure [**Environment**](#environment-credentials). Installed apps may add further tabs; you do not need them to start with files, chats, and tasks.

## Project credentials {#environment-credentials}

Open the project’s **Environment** tab to store encrypted credentials for that project. Only project administrators see the tab or can view the stored names and manage credentials. On an archived project, it is read-only; restore the project before changing credentials.

Select **Add variable**, enter a name such as `SERVICE_TOKEN` and its value, then select **Save**. The editor requires unique names matching `^[A-Za-z_][A-Za-z0-9_]*$`: letters, digits and underscores, with no digit at the start. The server also converts names to uppercase and requires a letter at the start and at most 64 characters. Use uppercase names beginning with a letter; names that differ only in case refer to the same stored credential.

Saved values are never shown again. To replace one, enter the new value in its existing row and select **Save**. To delete one, select **Remove**, confirm, then select **Save**.

The tab describes credentials for task runtimes such as Hermes and OpenClaw, but project credentials are currently stored without being injected into agent runs. To supply a running agent with environment variables, use the organization credentials granted under **Secrets** when you [configure the agent](/platform/projects/project-agents#configure-the-agent). Those grants reach the task runtime at execution time, including automation agent nodes with their own grants; a run a Member starts receives none. The ordinary Chat assistant does not receive these environment variables.

If the initial credential list cannot load, the editor is hidden; select **Try again** before editing. A failed refresh keeps the last list and your draft with a warning that the display may be out of date.
