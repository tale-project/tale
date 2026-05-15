---
title: Build your first agent end to end
description: Create a purpose-built agent, attach knowledge, test it, and publish a version.
---

Generic chat answers questions with whatever the model has been trained on; a purpose-built agent answers with your organisation's knowledge, in your tone, scoped to one job — "Product support", "HR policies", "Sales enablement". This tutorial takes you from an empty agent page to a versioned agent your team can pick in the chat agent selector. Feature reference lives at [Agent concepts](/platform/agents/concepts) and [Create an agent](/platform/agents/create); this page stitches those into a concrete outcome.

The outcome at the end is a published agent with one job, the right knowledge scope, and a smoke test you've run yourself.

## Before you begin

You need Editor access or higher in your Tale instance — Owner, Admin, Developer, and Editor all qualify; Member and Disabled don't. Confirm the role on your profile page if you're not sure. You also need at least one folder in the [Knowledge base](/platform/workspace/knowledge-base) that matches the agent's job; if your org's knowledge isn't structured into folders yet, create one with three or four representative documents before continuing — an agent with no relevant knowledge is harder to test honestly.

No external account, no API key, no feature flag.

## Step 1 — Decide what the agent is for

The single hardest thing about an agent is naming what it doesn't do. Before clicking anything, write one sentence on paper or in a draft: "This agent answers X using Y, and does not do Z." For example: "This agent answers product-support questions using the Help Center folder, and does not give legal or billing advice." That sentence becomes the backbone of your system instructions — without it, the agent drifts towards whatever the user asks, even when the answer is outside its scope.

The step worked when the sentence makes the agent's job and its refusal cases both explicit.

## Step 2 — Create the agent

Open **Agents** in the sidebar and click **Create agent**. Give it a **Display name** ("Product Support"), an **Internal name** — a URL-safe slug used in API calls and the chat URL (`product-support`), and a short description. Save.

The internal name is permanent in practice: agents are addressed by slug from automations, the API, and the chat URL, so renaming later breaks every link that points at the old one. Pick something you can live with.

The step worked when the agent's configuration page opens with its tabs (Instructions, Knowledge, Tools, Conversation starters, Webhook, Versions) lined up at the top.

## Step 3 — Write the instructions

Open the **Instructions** tab and paste a system prompt built around the sentence from Step 1. The skeleton below covers the four things every agent's prompt needs — identity, scope, rules, output shape:

```text
You are the <role> for <organisation>.

Your job is to <task>, using <scope of knowledge>.

Rules:
- Always respond in the user's language.
- Cite the source document when you answer from the knowledge base.
- If a question is out of scope, say so and suggest where to ask.

Tone: <tone>.
Format: <format>.
```

Pick a **Model preset** (Fast / Standard / Advanced) that matches the task: Fast for short lookups, Advanced for multi-step reasoning. The mapping from preset to actual model lives in [Agent concepts — Model](/platform/agents/concepts#model).

Changes save automatically; an indicator in the top-right shows the save state.

The step worked when the save indicator settles on "saved" and the prompt preview renders the text you pasted without truncation.

## Step 4 — Scope the knowledge

Open the **Knowledge** tab. The default is the full organisation knowledge base, which is almost always too broad — irrelevant search hits crowd out the relevant ones, and the agent's answers blur. Uncheck everything that isn't the agent's job and keep only the folders that match.

A narrow scope produces sharper answers. A support agent reading `Help Center` only will outperform a support agent reading every folder in the org, every time.

The step worked when the Knowledge tab lists one or two folders and the rest are unchecked.

## Step 5 — Turn off the tools you don't need

Open the **Tools** tab and disable anything the agent shouldn't use. A support agent probably doesn't need web search; a research agent probably doesn't need the billing integration. Fewer tools means fewer surprises in production — and fewer tools the model has to reason over, which speeds up the response.

The step worked when only the tools the agent genuinely uses are toggled on.

## Step 6 — Add conversation starters

Open the **Conversation starters** tab and add two or three example prompts. They show on the empty-state screen when a user opens a new conversation with the agent, and they double as a smoke-test list for Step 7: if a starter answers well, the agent is at least pointing in the right direction.

The step worked when the starters appear under the composer when you open a new chat with the agent.

## Step 7 — Test from chat

Open **Chat** in the sidebar, pick the new agent in the agent selector, and try each conversation starter plus one or two ad-hoc questions you'd expect a colleague to ask. Watch for three things: does the agent cite the right documents, does it refuse out-of-scope questions cleanly, and does the tone match what you wrote in the instructions.

Iterate by switching back to the Instructions tab, tightening the prompt, and retesting. This loop is the bulk of agent building — most agents need three or four iteration rounds before they're good.

The step worked when the agent answers a representative in-scope question with a citation and refuses an out-of-scope question with a one-sentence redirect.

## Step 8 — Publish a version

Every edit so far has updated a **draft**; the live version (if there's a previous one) keeps serving chat until you publish. Click **Publish** in the version header. Future edits start a new draft — users keep hitting the published version until you publish again.

The step worked when the version header shows a fresh version number and "Published" badge, and the agent's draft tab is empty.

## Troubleshooting

- **The agent cites the wrong document on every question** — the Knowledge tab's scope is still too broad, or one folder dominates by document count. Narrow further, or split into two agents (`support-public` and `support-internal`) with different scopes.
- **The agent refuses in-scope questions** — the system prompt's "Rules" section is too restrictive, or the task description doesn't match how users actually phrase questions. Loosen the rules and rephrase the task in the user's voice.
- **Conversation starters don't appear** — the agent has at least one published version but you're looking at a draft preview, or the starters were saved on a different agent draft. Switch to the published version's preview.
- **Publishing failed with a validation error** — required fields (display name, slug, system instructions) are empty, or the slug collides with an existing agent. The error toast names the field.

## Where this gets used

What you built is a versioned, knowledge-scoped agent your team can pick from the chat selector — and the same agent is also reachable from automations, the public API, and the Webhook tab without any extra wiring. The four decisions you just made (instructions, knowledge, tools, model) hold across every surface where the agent runs, which is the whole point of the agent abstraction.

Two natural next moves from here: let scripts call the agent directly with [Call Tale from a script](/tutorials/developer/call-tale-from-a-script), or wire the same agent into a multi-step workflow with [Trigger an automation via webhook](/tutorials/developer/trigger-automation-via-webhook).
