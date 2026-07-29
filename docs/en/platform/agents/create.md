---
title: Create an agent
description: Walk from an empty create dialog to a working agent — name it, write its instructions, grant tools and skills, scope its knowledge, and try it in chat.
---

This walkthrough goes from an empty create dialog to an agent your teammates can pick. The result is a persona that knows its domain, holds the tools it needs to act on what it reads, and is reachable from any chat in your organization. Budget about fifteen minutes.

The running example is a support-triage agent — the same one [Agent concepts](/platform/agents/concepts) introduces. Substitute your own domain freely; none of the steps depend on the example.

## Before you begin

Two things should be in place:

- Your organization has at least one provider credential under **Settings > Providers**. The agent itself names no model — whoever sends a message picks one in the composer — but the composer has nothing to offer until a credential exists. Cloud users get one by default; self-hosted operators follow [Configuration → providers](/self-hosted/configuration/providers).
- You hold the Editor role or higher here. Check [Members and roles](/platform/admin/members-and-roles) if you are not sure what you hold.

## Step 1 — Name it and decide who sees it

Open **Agents** in the sidebar and create a new one. The dialog asks for a **Name** — the unique id used in links and the API, which you cannot change afterwards, so keep it descriptive and lowercase, `support-triage` rather than `agent2` — plus a **Display name** teammates meet it by and a short **Description**. Confirm and the editor opens on **General**.

**General** is where identity lives: the display name, the description, an icon, and the agent's **visibility**. Keep an agent private while you are still shaping it and only you reach it; share it with the organization and every member can pick it in the composer. A private agent records an owner, which is you — an agent nobody owns and nobody can see would be reachable by nobody at all.

## Step 2 — Write the instructions

Open **Instructions**. The field is plain markdown, capped at 20,000 characters, and it is prepended to every turn the agent answers. Three pieces of advice from the field:

- **Open with the voice.** One paragraph naming who the agent is, who it answers to, and what tone it strikes. The model treats this as the strongest signal in the whole file.
- **Name the refusal cases explicitly.** Three or four sentences saying what the agent declines to do, and what it says when it declines.
- **Resist specifying every behaviour.** Long instructions get diluted in long conversations. If a behaviour belongs in code, lean on a tool; if it belongs in documents, lean on the knowledge scope; if it repeats across agents, lean on a skill.

Instructions can be translated per locale alongside the display name and description, so a French reader gets an agent briefed in French rather than an English brief answering in French.

## Step 3 — Grant tools and skills

Switch to **Tools**. Tools are individual switches grouped into category cards — contacts, products, files, knowledge, automations, and more — and each one you grant widens what the agent may read or change on your behalf. Grant the smallest set that does the job and leave the rest off. Connected integrations and the organization's automations appear in the same list, so binding one is the same move as granting a platform tool.

<Frame caption="The tool catalog — one card per category, each counting how many of its tools the agent has been granted.">

![The agent editor's Tools tab scrolled to the category cards, with Knowledge at three of four tools checked and Files at seven of seven, while Conversations, Discussions, Analytics, and Tasks & projects have none granted.](/images/platform/agent-editor-tools.webp)

</Frame>

<Note>

**Run code** executes scripts in a sandbox and is governed by the organization's [run-code policy](/platform/admin/governance/run-code-policy) — the switch grants the tool, the policy decides what a run may actually do.

</Note>

Then open **Skills** and bind the bundles this agent should be able to expand, up to ten. A skill is a knowledge pack from the organization's [skill library](/platform/workspace/skills): bind the house reply-tone bundle here and the triage agent phrases its answers the way every other agent does. Leave the list empty and the agent expands nothing.

## Step 4 — Scope its knowledge

Switch to **Knowledge**. One setting decides which corpus the agent's retrieval may read: the organization's own uploaded **documents**, the **web** pages fetched on its behalf, **all** of it fused together, or **none**, which offers the agent no retrieval at all. Retrieval runs only when the agent decides it needs it — nothing is injected into a reply it did not ask for.

Narrow the scope when you can. Everything in scope competes for relevance on every question, so an agent pointed at the documents that matter answers better than one pointed at everything the organization owns.

## Step 5 — Save it and try it

Click **Save**. Open a new chat, pick the agent, pick a model in the composer's picker, and send a message that exercises the knowledge and the tools you granted. The model is your choice on every turn, so the same agent can answer a cheap question on a small model and a hard one on a large model without any edit.

If the agent answers the way you wrote it, you are done. If it does not, the **History** button at the top right of the editor holds every saved version and lets you compare or restore — see [Agent versions](/platform/agents/versions).

## Troubleshooting

- **The agent does not appear in the chat picker.** Its visibility is still private, so only you see it. Share it with the organization on the **General** tab.
- **Replies ignore the knowledge.** The knowledge scope may be set to none, or the document may not be indexed yet — open it from [Documents](/platform/knowledge/documents) to check its state.
- **A bound skill never gets used.** A model reaches for a skill by its description, so a vague description gets skipped; say what the skill does and when it applies. A bundle marked `disable-model-invocation` deliberately waits to be named.
- **A tool call is refused at runtime.** A governance policy is gating the tool: the agent is allowed to call it, and the runtime declines. Check [Policies and limits](/platform/admin/governance/policies-and-limits).

## Where this gets used

Creating one agent is the point where the rest of the platform starts to feel like Tale rather than a generic chat window. You have written a persona, drawn its boundaries with two allowlists and a knowledge scope, and left every question about how a turn runs to the conversation itself. The natural next walk is [Agent with knowledge](/tutorials/editor/agent-with-knowledge) — the same shape, but it binds a folder of documents and exercises the citation pipeline end to end. To see an agent hand a sub-task to a spawned worker, walk [Hand work to a worker](/tutorials/editor/delegate-between-agents).
