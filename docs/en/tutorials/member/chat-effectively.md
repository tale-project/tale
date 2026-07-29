---
title: Chat effectively
description: Five habits that turn a chat from "thanks for the wall of text" into "exactly what I needed" — naming the agent, picking the model, attaching the right file, asking in scope, and reading the citations.
---

Chatting effectively in Tale is not about clever prompts; it is about giving the chat enough context for the model to read your intent the first time. Five small habits — picking the right agent, picking the right model, attaching only what matters, asking inside a scope, reading the citations — turn the average reply from "thanks for the wall of text" into "exactly what I needed". This page walks the habits in order on a fresh chat.

You need a Member role (the floor for chat) and one published agent on the org you can address. The conceptual side lives in [Chat basics](/platform/chat/basics); this walk is the daily-driver mechanic.

## Habit 1 — Pick the agent before the first message

The agent is the lever with the highest payoff per click. The default Assistant is a blank canvas; an agent with knowledge bound, tools enabled, and a tuned voice will out-answer it for any non-generic question. Open the agent picker in the chat and pick the agent whose scope matches your question — Support, Sales, Research — before typing.

If no agent fits, leave the Assistant on; do not pick a wrong-fit agent for "close enough". A wrong-fit agent often refuses or veers off the bound knowledge.

## Habit 2 — Pick the model to match the message

The model picker beside the agent picker lists every model the org's provider credentials expose, grouped into **Models** and **Sandbox agents**. Nothing is picked for you, so switch whenever the message changes shape. A long reasoning question wants a larger model; a quick lookup wants a smaller, faster one. A message with an image needs a vision-capable model — without that, the image is silently dropped.

The model picker shows the tag (`Chat`, `Vision`, `Image`, `Embedding`) next to each name; match the tag to the message.

## Habit 3 — Attach only what the agent needs

Attachments are tempting to overuse. A 200-page PDF as a single attachment fills the context budget and dilutes the answer; the relevant pages excerpted into the prompt outperform the whole file. If you do attach a long document, ask a specific question against it ("what does page 12 say about refunds?") rather than an open one ("tell me everything").

For files you will reference often — a price list, a policy document — upload them into the [Knowledge](/platform/knowledge/documents) section and bind them to an agent. Once bound, every chat with that agent has them on tap without re-uploading.

## Habit 4 — Ask inside the agent's scope

Every agent has an implicit scope from its instructions and bound knowledge. Asking a billing agent about marketing strategy gets you a polite refusal at best, a hallucination at worst. The cheap fix: read the agent's bio at the top of the picker before you ask — it names the scope. If your question is outside the scope, switch agents.

## Habit 5 — Read the citations and follow them

When the reply includes citations (the small inline links), open one. The citation points to the chunk of the source the agent quoted from; reading it confirms the agent did not paraphrase past what the source actually says. The two-minute habit of opening one citation per reply catches the small subset of replies where the agent overreached.

## Where this fits

Five habits, one chat, the same loop every time you open the Chat tab. The habits compound — picking the right agent makes the right model obvious; the right model makes the citations trustworthy; the citations close the loop.

For the surface these habits live on, see [Chat basics](/platform/chat/basics). For the file side — what gets pasted verbatim, what gets indexed — see [Attachments](/platform/chat/attachments).
