---
title: Build your first agent
description: Walk a fresh project from "I want an agent" to a reviewed task result — create a project agent with a harness, a model, and a paragraph of instructions, hand it a real task, and review what comes back.
---

A first agent is the smallest useful thing in Tale: a name, a harness, a model, and a paragraph of instructions on a project's **Agents** tab. This walk creates one, hands it a real task, and reviews the result where every agent's work waits — the **In review** column. The shape generalises: every agent you build later is the same four moves with different choices, and the loop at the end is the one you spend the most time in.

You need edit access to a project and at least one provider under **Settings > AI providers** with a model on it. The conceptual side lives in [Agent concepts](/platform/agents/concepts) and the field-by-field reference in [Project agents](/platform/projects/project-agents); this walk is the end-to-end mechanic.

## Before you begin

Confirm three things. You can edit the project — anyone with project edit access creates, edits, and deletes its agents, up to 50 per project. The organization has a provider configured with at least one model; without that there is nothing to pick under **Model**, and the run at the end has nothing to call. And you have a job in mind narrow enough that a paragraph of instructions can frame it — this walk uses "summarise an inbound contact message into one sentence plus a recommended next action".

## Step 1 — Name the agent and pick its engine

Open the project's **Agents** tab. It lists the project's crew, one row per agent, and this is where the agent you are about to create lands.

<Frame caption="The Agents tab — each row names the agent's harness, serving provider, and model.">

![The Agents tab of the Website relaunch project listing two named agents — Content editor on Claude Code and Redirect auditor on Codex — each row naming the serving provider and model id, beside a New agent button.](/images/platform/project-agents-models.webp)

</Frame>

Click **New agent**. The first three fields decide what runs:

- **Name** — `Triage assistant`. Your team sees it on task cards, so name it for the job.
- **Agent type** — the coding harness the agent runs on. [Harnesses](/platform/agents/harnesses) compares them and says which credentials each accepts.
- **Model** — the list is searchable, and a model served by more than one provider appears once per provider. The pick is exact: runs call that model through that provider, and the spend lands on that provider's credential.

## Step 2 — Leave the equipment empty

**Skills, connectors & tools** decide what the agent can reach beyond its sandbox: skills stage reference bundles, connectors broker a connected service, and platform tools let it read — or, when you grant a write tool, change — the project's tasks, documents, and knowledge. For triage, grant nothing: the agent reads input and writes output, and every tool you grant widens the trust boundary. Leave **Secrets** empty too — that is the escape hatch for a service with no connector, and this agent calls none.

If the agent should later write the recommended action into a CRM, you would equip the corresponding connector then — but not before the text-only version works.

## Step 3 — Write the instructions and create it

**Instructions** ride along on every run as a standing instruction — what the agent owns, how it works, and where it stops. This is the field most people overshoot; keep it under a paragraph:

```text
You read a contact message and produce two lines. Line one: a one-sentence summary in plain English. Line two: a recommended next action — reply, escalate, or close. If the message is blank or off-topic, refuse and say so.
```

Click **Create agent**. The row lists the harness, the serving provider, the model, and the equipped count — there is no publish step, and the agent can be assigned work from this moment.

## Step 4 — Hand it a task and review the result

Create a task on the project board, paste a real contact message into its description, and pick a **Reviewer** in the task sheet — without one, the review request lands with the task's creator. Assign the task to `Triage assistant` and click **Start agent**. The card moves to _In progress_ while the agent works in its sandbox; when it finishes, its report lands as a task comment and the card parks at **In review** — agents never set _Done_.

Read the comment: it should hold two lines per the instructions, a one-sentence summary and a recommended action. Move the card to _Done_ to accept it. If the format drifted, @-mention the agent in a task comment with the correction — a rework run continues the same conversation and parks the result at _In review_ again — and tighten the **Instructions** on the agent for next time; edits apply from the next run.

## Where this fits

Four moves, one agent, one reviewed result: the same shape every agent you build later follows. [Task automation](/platform/projects/task-automation) is the board loop you ran a moment ago, end to end — the Driver/Reviewer split, mentions, retries, and the kill switch. [Project agents](/platform/projects/project-agents) is the reference for every field you touched, and [Agent concepts](/platform/agents/concepts) the model behind it.

The knobs that used to sit on an agent editor live elsewhere in this version: knowledge is organization-wide under [Knowledge](/platform/knowledge/overview) and reached through platform tools ([Project agents](/platform/projects/project-agents) explains how), and work that should run without a person is an [automation](/platform/automations/concepts) rather than a second agent.
