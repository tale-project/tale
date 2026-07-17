---
title: Create an agent
description: Walk from the Create agent dialog to a published agent — name it, write instructions, scope its knowledge, grant tools, and verify it in Chat.
---

This tutorial walks from an empty **Create agent** dialog to an agent you publish and use. The result is a working agent that knows its domain, has the tools to act on what it reads, and is reachable from any chat in your org. About fifteen minutes if you have a model provider already configured; longer if you also have to set one up.

The tutorial uses a support-triage agent as the running example — the same one [Agent concepts](/platform/agents/concepts) introduces. Substitute your own domain freely; the steps do not depend on the example.

## Before you begin

Make sure two things are in place:

- A model provider is configured under **Settings > Providers**. Cloud users get one by default; self-hosted operators follow [Configuration → providers](/self-hosted/configuration/providers). Without one the dialog stops you: an agent needs a model to run.
- You hold the Editor role or higher in this org. Check your member row under **Settings > Organization** if you are not sure.

## Step 1 — Create the agent

Open **Agents** in the sidebar and click **Create agent**, then pick **Blank** (the menu also offers **From template** and **Upload file** for importing agent JSON). The dialog asks for four things: a **Name** — the unique id used in links and the API, which you can't change later — use lowercase letters, numbers, hyphens, and underscores only, e.g. `seo-writer` — a **Display name** teammates see in chat, a **Description**, and the **Model** list. The first model is the default and the rest are fallbacks; drag to reorder or add more anytime. Click **Continue** and the editor opens on the **General** tab.

<Frame caption="The agents list — Create agent sits top right.">

![The agents list with the chat folder expanded, showing the Assistant and Automation Assistant rows with their default models and tool counts.](/images/platform/agents-list-expanded.webp)

</Frame>

## Step 2 — Write the instructions

Open **Instructions & models**. The **System instructions** field is plain markdown, with **Browse prompts** to start from the org's prompt library and template variables that resolve at runtime. Three pieces of advice from the field:

- **Open with the voice.** One paragraph naming who the agent is, who it answers to, and what tone it strikes. The model treats this as the strongest signal.
- **Name the refusal cases explicitly.** Three or four sentences that say what the agent declines to do and what it says when it declines.
- **Resist specifying every behaviour.** Long instructions get diluted in long conversations. If a behaviour belongs in code, lean on a tool; if it belongs in data, lean on knowledge.

The same tab holds the model list you set in the dialog — the first model is the primary, and each model below is the next fallback when the one above is unavailable.

<Frame caption="Instructions & models — the system prompt above, the ordered model list below.">

![The Instructions & models tab of the agent editor, showing the system instructions field with locale tabs and an ordered list of five models with reorder controls.](/images/platform/agent-editor-instructions.webp)

</Frame>

## Step 3 — Scope its knowledge

Switch to the **Knowledge** tab. Pick a **Retrieval mode** — **Tool** lets the agent search on demand, **Context** injects relevant knowledge into every response, **Both** does both, **Off** disables the knowledge base. Then scope what is searchable: **Include team documents**, **Include organization documents**, and **Agent documents** you upload for this agent alone. Bind the smallest useful set — everything you include competes for retrieval on every question.

<Frame caption="The Knowledge tab — retrieval mode, document scopes, and the indexed organization documents.">

![The agent editor's Knowledge tab with Tool picked as the retrieval mode, the team and organization document toggles both on, and the organization documents list where every file carries an Indexed badge.](/images/platform/agent-editor-knowledge.webp)

</Frame>

## Step 4 — Grant the tools

Switch to the **Tools** tab. Tools are individual checkboxes grouped by category — contacts, products, files, workflows, and more — plus a **Web search** mode selector at the top. Grant what the agent needs and leave the rest off; every toggle widens the trust boundary.

<Frame caption="The Tools tab — a per-tool checklist grouped into category cards, each counting what it has granted.">

![The agent editor's Tools tab scrolled to the category cards, with Knowledge at three of four tools checked and Files at seven of seven, while Conversations, Discussions, Analytics, and Tasks & projects have none granted.](/images/platform/agent-editor-tools.webp)

</Frame>

<Note>

**Run code** (under **System**) executes scripts in a sandbox and is governed by the org's [run-code policy](/platform/admin/governance/run-code-policy) — the checkbox grants the tool, the policy decides what a run may do.

</Note>

## Step 5 — Make it visible and try it

Back on **General**, flip **Visible in chat** on and click **Save**. A toast confirms **Agent saved**. Open a new chat, pick the agent from the picker, and send a message that exercises the knowledge and tools you granted. If the agent answers the way you wrote it to, you are done; if it does not, the **History** button at the top right of the editor shows every saved version and lets you compare or restore.

## Troubleshooting

- **Saving fails with a model warning.** The agent has no model set — add one on the Instructions & models tab before saving.
- **Agent does not appear in the chat picker.** Confirm **Visible in chat** is on; when it is off the agent can only be reached through delegation. If it is on, check the **Access** section — an agent assigned to a team is only usable by that team.
- **Replies ignore the knowledge.** The retrieval mode may be **Off**, the scope toggles off, or the document not yet **Indexed** — open it from [Documents](/platform/knowledge/documents) to check.
- **A tool call is refused at runtime.** A governance policy is gating the tool: the agent definition allows it, the runtime refuses. Check [Policies and limits](/platform/admin/governance/policies-and-limits).

## Where this gets used

Creating one agent is the moment the rest of the platform starts to feel like Tale rather than a generic chat. The natural next walk is [Agent with knowledge](/tutorials/editor/agent-with-knowledge) — same shape, but binds a folder of documents and exercises the citation pipeline end to end. To see an agent hand a sub-task to a spawned worker, [Hand work to a worker](/tutorials/editor/delegate-between-agents) is the walk.
