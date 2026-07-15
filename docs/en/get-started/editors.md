---
title: Your first day building agents
description: The editor journey — create an agent, give it instructions and a model, make it visible in chat, and watch it answer.
---

This journey is for the person who turns "the team keeps asking the same questions" into an agent that answers them. In fifteen minutes you create an agent, shape how it behaves, and watch it answer in chat — the loop every later agent refines.

You need the **Editor** role or higher (the Agents section is hidden from members) on a workspace where chat already answers — that is the [quickstart](/get-started/quickstart).

<Steps>

<Step title="Create the agent">

To start an agent teammates can pick in chat, open **Agents** in the sidebar and click **Create agent**. Name it for the job, not the technology — "Support Triage" beats "GPT Helper" — because the name is what teammates pick from the chat later.

</Step>

<Step title="Shape its identity">

The editor opens on the **General** tab: the display name teammates see, a one-line description, and the agent type. The switch that matters on day one is **Visible in chat** — without it the agent exists but nobody can pick it from the chat.

<Frame caption="The General tab — identity, agent type, and chat visibility.">

![The agent editor's General tab for the Assistant agent, showing the agent type options, the Visible in chat toggle, and the display name field.](/images/get-started/agent-editor-general.webp)

</Frame>

</Step>

<Step title="Write the instructions">

Open **Instructions & models** — the knob that matters most. Write one paragraph as if briefing a new colleague: the voice to answer in, the domain it owns, and the cases it should refuse. Concrete beats complete — you will refine after seeing real replies.

<Frame caption="Instructions & models — the system prompt above the ordered model list.">

![The agent editor's Instructions & models tab showing the system prompt field and the ordered model list for the Assistant agent.](/images/platform/agent-editor-instructions.webp)

</Frame>

</Step>

<Step title="Bind the model">

The same tab binds the model: pick one from the workspace's configured providers, or leave routing on automatic so Tale resolves the best available model per request. Click **Save** — an **Agent saved** toast confirms the write.

</Step>

<Step title="Watch it answer">

Open **New chat**, pick your agent from the agent picker, and ask something squarely inside the instructions you wrote. Then ask something the instructions say to refuse.

<Frame caption="The agent picker — your new agent listed beside the catalog agents.">

![The chat's agent picker open, listing the agents available in the workspace.](/images/platform/chat-agent-picker.webp)

</Frame>

<Check>

An on-voice answer to the first message and a refusal to the second means the instructions bind — the agent is real.

</Check>

</Step>

</Steps>

## Where you are now

You have shipped the smallest real agent: instructions, a model, a place in the picker. The full model behind what you touched is [Agent concepts](/platform/agents/concepts) — instructions, knowledge, tools, and model as four knobs. The natural next build is [your first agent end to end](/tutorials/editor/first-agent-end-to-end), which adds knowledge bindings and a real domain; after that, [agents with knowledge](/tutorials/editor/agent-with-knowledge) and [delegation between agents](/tutorials/editor/delegate-between-agents) take the same loop further.
