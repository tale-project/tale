---
title: Hand work to a worker
description: The spawn_agent worker and its job card are not part of this version — hand work to a project agent through a board task, or to an automation through its agent node.
---

This tutorial used to run one research job through a **worker**: you asked the assistant for open-ended, citable work, it called `spawn_agent`, and a job card under its turn showed the worker's progress, result, and transcript. That tool does not exist in this version of Tale — the chat assistant carries three read-only retrieval tools and cannot spawn anything, so there is no job card to read. Handing work to an agent is still the everyday move; it runs through the project board instead, where the hand-off has an owner and a reviewer.

<Note>

Worker delegation from chat is not available in this version. Chat answers questions and retrieves; work that produces something is a task assigned to a project agent.

</Note>

## Hand work over today

The real walk is short, and every step of it is visible on the board:

1. **Staff the project.** Open the project's **Agents** tab and make sure an agent exists — [Project agents](/platform/projects/project-agents) walks the dialog, and [Build your first agent](/tutorials/editor/first-agent-end-to-end) creates one from scratch.
2. **Write the request as a task.** Create a task and put the brief in its description — for the research example, the question, the sources you accept, and the shape of answer you want. Attach input files to the task when the work needs them.
3. **Assign and start.** Assign the task to the agent and click **Start agent**. The card moves to _In progress_ and the agent works in its own sandbox with the description, comments, and input files as context.
4. **Review.** The report lands as a task comment, produced files as deliverables, and the task parks at **In review** — the task's **Reviewer** gets a bell and an email. Move the card to _Done_ to accept; to send it back, @-mention the agent in a comment with your feedback, and a rework run continues where the previous one left off.

[Task automation](/platform/projects/task-automation) is that loop end to end, including what happens when a run fails.

## Without a person in the loop

When the hand-off should happen on its own, an **automation** does it: its agent node runs a harness turn as one step of a workflow — on a schedule, a webhook, or an event — next to the connector actions and code nodes around it. [Automation concepts](/platform/automations/concepts) explains the pieces; [Built-in automations](/platform/automations/builtin) shows the shipped packs.

## Where this fits

Delegation in this version is explicit and reviewable: a task names the agent and the reviewer, an automation names its trigger and its nodes, and nothing is spawned behind a chat reply. Reach for a task when a person should review the result; reach for an automation when the work has fixed stages and should run on its own. The conceptual side is [Agent workers](/platform/agents/delegation).
