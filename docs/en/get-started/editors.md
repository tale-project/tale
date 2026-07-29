---
title: Your first day building agents
description: The editor journey — create an agent, give it instructions, make it visible in chat, and watch it answer.
---

This journey is for the person who turns "the team keeps asking the same questions" into an agent that answers them. In fifteen minutes you create an agent, shape how it behaves, and watch it answer in chat — the loop every later agent refines.

You need the **Editor** role or higher (the Agents section is hidden from members) on a workspace where chat already answers — that is the [quickstart](/get-started/quickstart).

<Steps>

<Step title="Create the agent">

To start an agent teammates can pick in chat, open **Agents** in the sidebar and click **Create agent**. Name it for the job, not the technology — "Support Triage" beats "GPT Helper" — because the name is what teammates pick from the chat later.

</Step>

<Step title="Shape its identity">

The editor opens on the **General** tab: the display name teammates see and a one-line description. The switch that matters on day one is **Visible in chat** — without it the agent exists but nobody can pick it from the chat.

</Step>

<Step title="Write the instructions">

Open **Instructions** — the knob that matters most. Write one paragraph as if briefing a new colleague: the voice to answer in, the domain it owns, and the cases it should refuse. Concrete beats complete — you will refine after seeing real replies. Click **Save**; the agent is reachable from the next request, with no separate publish step.

</Step>

<Step title="Watch it answer">

Open **New chat**, pick your agent from the agent picker, and pick a model beside it — an agent carries no model of its own, so the choice is yours on every chat. Ask something squarely inside the instructions you wrote, then ask something the instructions say to refuse.

<Check>

An on-voice answer to the first message and a refusal to the second means the instructions bind — the agent is real.

</Check>

</Step>

</Steps>

## Where you are now

You have shipped the smallest real agent: instructions and a place in the picker. The full model behind what you touched is [Agent concepts](/platform/agents/concepts) — instructions, knowledge, tools, and skills. The natural next build is [your first agent end to end](/tutorials/editor/first-agent-end-to-end), which adds knowledge bindings and a real domain; after that, [agents with knowledge](/tutorials/editor/agent-with-knowledge) and [delegation between agents](/tutorials/editor/delegate-between-agents) take the same loop further.
