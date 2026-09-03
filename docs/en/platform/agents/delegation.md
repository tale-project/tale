---
title: Agent workers
description: The spawn_agent worker tool is not part of this version — work is handed to a project agent through a board task and to an automation through its agent node.
---

This page used to explain workers: a `spawn_agent` tool with which the agent you chat with composed an ephemeral sub-agent, ran it, and folded the result into its reply under a job card. That tool does not exist in this version of Tale — the chat assistant has no way to spawn anything, and there is no job card. Handing work to an agent is still the core move; it runs through tasks and automations instead.

<Note>

Worker delegation from chat is not available in this version. Chat answers questions and retrieves; work that produces something is a task assigned to a project agent.

</Note>

## Hand work over today

Assign a board task to a **project agent** and click **Start agent**. The agent works in an isolated sandbox with the task's description, comments, and input files as context, posts its report back as a task comment, attaches produced files as deliverables, and parks the task at **In review** — agents never complete work, a person does. Steer a live run or start the next one by @-mentioning the agent in a task comment; it reads your comment first and continues where the previous run left off. [Task automation](/platform/projects/task-automation) is the loop end to end, [Project agents](/platform/projects/project-agents) the crew you assign from.

When the hand-off should happen without a person, an **automation** does it: its agent node runs a harness turn as one step of a workflow, on a schedule, a webhook, or an event, next to the connector actions and code nodes around it. [Automation concepts](/platform/automations/concepts) explains the pieces; [Built-in automations](/platform/automations/builtin) shows the shipped packs.

## Where this fits

Delegation in this version is explicit and reviewable: a task names the agent and the reviewer, an automation names its trigger and its nodes, and nothing is spawned behind a reply. Reach for a task when a person should review the result; reach for an automation when the work has fixed stages and should run on its own.
