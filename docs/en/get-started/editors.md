---
title: Your first day building agents
description: The editor journey — create a project agent, give it instructions, and watch it do real work on a task.
---

This journey is for the person who turns "the team keeps asking the same questions" into an agent that answers them. In fifteen minutes you create an agent on a project, shape how it behaves, and watch it do real work on a task — the loop every later agent refines.

You need edit access to a project and at least one provider under **Settings > AI providers** with a model on it; a chat that already answers means the provider is there — that is the [quickstart](/get-started/quickstart). Agents in this version live on projects: there is no agents entry in the sidebar and no agent to pick in chat.

<Steps>

<Step title="Create the agent">

To start an agent teammates can put to work, open a project's **Agents** tab and click **New agent**. Name it for the job, not the technology — "Support Triage" beats "GPT Helper" — because the name is what teammates see on task cards when they assign work to it.

</Step>

<Step title="Pick its harness and model">

The dialog asks for an **Agent type** — the coding harness the agent runs on — and a **Model**; a model served by more than one provider appears once per provider, and the pick is exact. Leave **Skills, connectors & tools** and **Secrets** empty on day one: every tool you grant widens what the agent can reach, and the first job needs none.

</Step>

<Step title="Write the instructions">

**Instructions** is the knob that matters most. Write one paragraph as if briefing a new colleague: the voice to answer in, the domain it owns, and the cases it should refuse. Concrete beats complete — you will refine after seeing real results. Click **Create agent**; the agent can be assigned work from this moment, with no separate publish step.

</Step>

<Step title="Watch it work">

Agents do their work on tasks — chat runs the built-in assistant only. Create a task on the project board that states the work in one sentence, assign it to the agent, and click **Start agent**. The card moves to _In progress_ while the agent works in its sandbox; its report lands as a task comment and the card parks at **In review** — only a person moves it to _Done_.

<Check>

A result that follows the voice and scope you wrote means the instructions bind — the agent is real.

</Check>

</Step>

</Steps>

## Where you are now

You have shipped the smallest real agent: a named agent on a project's **Agents** tab with a paragraph of instructions. The full model behind what you touched is [Agent concepts](/platform/agents/concepts) — instructions, tools, skills, and knowledge scope — and [Project agents](/platform/projects/project-agents) is the field-by-field reference. The natural next build is [your first agent end to end](/tutorials/editor/first-agent-end-to-end), which runs the same four moves on a real domain and reviews the result; after that, the [Knowledge overview](/platform/knowledge/overview) says where knowledge lives, and [Task automation](/platform/projects/task-automation) how work moves across the board from one agent to the next.
