---
title: Build your first agent end to end
description: Create a purpose-built agent, attach knowledge, test it, and publish a version.
---

Generic chat answers questions with whatever the model has been trained on. A purpose-built agent answers with your organisation's knowledge, in your tone, scoped to one job — "Product support", "HR policies", "Sales enablement". This tutorial takes you from an empty agent page to a live, versioned agent your team can pick in chat.

You need Editor access or higher. Feature reference lives at [Agent concepts](/platform/agents/concepts) and [Create an agent](/platform/agents/create); this tutorial stitches those steps into a concrete outcome.

## Step 1 — Decide what the agent is for

Before clicking anything, write one sentence: "This agent answers X using Y, and does not do Z." Example: "This agent answers product-support questions using the Help Center folder, and does not give legal or billing advice." That sentence becomes the backbone of your system instructions — without it, the agent drifts.

## Step 2 — Create the agent

Navigate to **Agents** in the sidebar and click **New Agent**. Give it a Display Name ("Product Support") and an Internal Name — a URL-safe slug used in API calls and the chat URL (`product-support`). Add a short description, then click **Create**.

You land on the configuration page. Leave all tabs at their defaults for now.

## Step 3 — Write the instructions

Open the **Instructions** tab. Paste a system prompt built from the sentence in Step 1. A reusable skeleton:

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

Pick a **Model preset** (Fast / Standard / Advanced) that matches the task — Fast is fine for short lookups, Advanced for multi-step reasoning. See [Agent concepts — Model](/platform/agents/concepts#model) for the mapping.

Changes save automatically; an indicator in the top-right shows the state.

## Step 4 — Scope the knowledge

Open the **Knowledge** tab. Uncheck everything the agent should not read and keep only the folders that match its job. A narrow scope is almost always better than a broad one — fewer irrelevant search hits, shorter context, sharper answers. See [Agent concepts — Knowledge](/platform/agents/concepts#knowledge).

If the folders do not exist yet, create them in the [knowledge base](/platform/workspace/knowledge-base) first, then come back.

## Step 5 — Turn off tools you do not need

Open the **Tools** tab and disable anything the agent should not use. A support agent probably does not need web search. A research agent probably does not need the billing integration. Fewer tools means fewer surprises in production.

## Step 6 — Add a conversation starter

Open the **Conversation starters** tab and add two or three example prompts. They appear on the empty-state screen when a user opens a new conversation with the agent, and they also act as built-in smoke tests for Step 7.

## Step 7 — Test from chat

Open **Chat**, pick the new agent in the agent selector, and try each conversation starter plus one or two ad-hoc questions. Watch for:

- Does the agent cite the right documents?
- Does it refuse out-of-scope questions cleanly?
- Does the tone match what you wrote in the instructions?

Iterate on the Instructions tab, then retest. This loop is the bulk of agent building.

## Step 8 — Publish a version

Every edit creates a **draft**; the live version keeps serving chat until you publish. Once you are happy, click **Publish** in the version header. Future edits start a new draft — users keep hitting the published version until you publish again. See [Agent versions](/platform/agents/versions) for rollback.

## Next

- Let users call the agent from scripts: [Call Tale from a script](/tutorials/developer/call-tale-from-a-script).
- Wire the agent into an automated workflow: [Trigger an automation via webhook](/tutorials/developer/trigger-automation-via-webhook).
