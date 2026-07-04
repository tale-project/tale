---
title: Create an agent
description: Walk from an empty Create-agent dialog to a published agent — pick the model, write instructions, bind knowledge, toggle tools, and verify in Chat.
---

This tutorial walks from an empty **Create agent** dialog to an agent you publish and use. The result is a working agent that knows its domain, has the tools to act on what it reads, and is reachable from any chat in your org. About fifteen minutes if you have a model provider already configured; longer if you also have to set one up.

You need the Editor role or higher and a model provider configured under **Settings > Providers**; the first prerequisite below links the setup walkthrough if you do not. The voice this tutorial uses is the same voice the [Agent concepts](/platform/agents/concepts) page builds — read that page once before you write your first agent's instructions.

## Before you begin

Make sure two things are in place:

- A model provider is configured under **Settings > Providers**. Cloud users get one by default; self-hosted users follow [Configuration → providers](/self-hosted/configuration/providers).
- You hold the Editor role or higher in this org. Check **Settings > People** if you are not sure; the role is on your member row.

The tutorial uses a support-triage agent as the running example — the same one [Agent concepts](/platform/agents/concepts) introduces. Substitute your own domain freely; the steps do not depend on the example.

## Step 1 — Pick the primary model

Open **Agents** in the sidebar and click **Create agent**. The dialog drops you on the **Instructions & model** tab. Open the model picker and the search field expects a model name or family — type "gpt", "claude", or "llama" to filter. Pick a capable model for the primary; the agent's behaviour leans heavily on this choice. The picker also exposes a fallback slot — pick a smaller, cheaper model so the agent keeps running when the primary is rate-limited.

## Step 2 — Write the instructions

The instructions field is plain markdown. Three pieces of advice from the field:

- **Open with the voice.** One paragraph naming who the agent is, who it answers to, and what tone it strikes. The model treats this as the strongest signal.
- **Name the refusal cases explicitly.** Three or four sentences that say what the agent declines to do and what it says when it declines.
- **Resist the temptation to specify every behaviour.** Long instructions get diluted in long conversations. If a behaviour belongs in code, lean on a tool; if it belongs in data, lean on knowledge.

Save the agent with the **Save** button at the top right. The dialog stays open with the agent's ID visible in the URL — you can come back to refine.

## Step 3 — Bind knowledge sources

Switch to the **Knowledge** tab. Knowledge is what the agent can look at; nothing is bound by default. Click **Agent knowledge** and pick from the org's documents, customers, products, vendors, or websites. The agent will retrieve from these sources at reply time and cite what it used.

Two cautions:

- Bind the smallest useful set. A document bound but rarely retrieved still costs embedding cycles.
- Knowledge bound here is in addition to anything an agent's instructions tell it to retrieve directly. The instructions name the policy; the binding names the surface.

## Step 4 — Toggle the tools

Switch to the **Tools** tab. Tools are what the agent can do beyond generating text. The toggles are grouped by family — web, files, RAG, run code, sub-agents, workflows, MCP, integrations, human input. Toggle on what the agent needs and leave the rest off. Every toggle widens the trust boundary, so be parsimonious.

The toggles that need particular thought:

- **Run code** is gated by the org's [run-code policy](/platform/admin/governance/run-code-policy). If your org policy disallows it, the toggle reads as disabled.
- Chat agents can spawn focused **workers** for one-off sub-tasks on their own; [Agent workers](/platform/agents/delegation) covers when that is the right move.

## Step 5 — Publish and try it

Back on **Instructions & model**, flip **Visible in chat** on and click **Save**. A toast confirms **Agent saved**. Open a new chat, pick the agent from the picker, and send a message that exercises the knowledge and tools you bound. If the agent answers the way you wrote it to, you are done; if it does not, the **History** tab on the agent shows every change you have made and lets you compare or restore.

## Troubleshooting

- **Save is greyed out.** The instructions field is empty or the model picker has no selection. Both are required.
- **Agent does not appear in the chat picker.** Confirm **Visible in chat** is on. If it is, confirm the user picking the agent has access to it — Project agents do not appear outside their Project.
- **Replies say "no access" to a tool.** A governance policy is gating the tool. The agent definition allows it; the runtime is refusing. Check [Policies and limits](/platform/admin/governance/policies-and-limits).
- **Retrieval returns nothing.** The knowledge sources you bound may not contain what the prompt asked for. Verify the source is indexed by opening it from [Documents](/platform/knowledge/documents) and confirming the chunks render.

## Where this gets used

Creating one agent is the moment the rest of the platform starts to feel like Tale rather than a generic chat. The natural next walk is [Agent with knowledge](/tutorials/editor/agent-with-knowledge) — same shape, but binds a folder of PDFs and exercises the citation pipeline end to end. To see an agent hand a sub-task to a spawned worker, [Hand work to a worker](/tutorials/editor/delegate-between-agents) is the walk.
