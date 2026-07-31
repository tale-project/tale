---
title: Chat basics
description: What happens between hitting send and the reply landing — the composer's choices, what the model is given, the three retrieval tools, and how to read the thought timeline and sources.
---

This page is the mental model for everything in the Chat tab. It names the parts of the composer, traces a message from key-press to streamed reply, says exactly what the model is handed and what it may call along the way, and shows how to read what came back. Read it once and the rest of the chat pages are variations on the same flow.

<Frame caption="The Chat tab with a streamed reply above the composer.">

![A chat thread showing a user question about onboarding feedback and an assistant reply containing a markdown table of three themes.](/images/platform/chat-thread-reply.webp)

</Frame>

## The composer

The composer is the input strip at the bottom of the screen. The message field sends on **Enter** and breaks the line on **Shift+Enter**. One picker beside the `+` menu names the model and, for models that expose it, the reasoning effort — that is the whole set of choices, by design: there is no agent picker, no skill picker, and no control over where the turn runs. The `+` menu holds **Add photos & files** and, on chats that can host one, **Arena Mode** ([Arena Mode](/platform/chat/arena-mode)); **Read replies aloud** ([Voice mode](/platform/chat/voice-mode)) is the speaker toggle beside the microphone, and the microphone dictates into the field.

While a reply streams, the send button becomes stop. Stopping keeps everything that already streamed — the reply settles as it is, mid-sentence if that is where it was.

### Images

Paste a screenshot straight into the message field — copied image bytes attach instead of landing as text — or pick files through the `+` menu's **Add photos & files**. Each image stages as a small thumbnail above the field: click it to zoom, and its ✕ removes it. Up to ten images ride one message, and sending waits until every upload has landed.

A model that can see images receives the pixels themselves, inline with your words; for one that cannot, the composer says so while the images are staged — that model would only see the file names. Staged images belong to the conversation they were staged in (switching chats clears them), and regenerating a reply re-sends the same images.

Images are the only attachment kind chat takes: documents belong in [Knowledge](/platform/knowledge/overview), where `rag_search` can reach them, and work that produces files belongs to a task.

<Frame caption="The composer: message field, the model-and-effort picker, dictation, send.">

![The chat composer with its plus menu, model picker showing a model name, microphone button, and send button.](/images/platform/chat-composer.webp)

</Frame>

## Picking a model

You always name the model. There is no automatic routing, no complexity score deciding for you, and no chain that quietly swaps in a different model when the first one is slow — the reply in front of you came from the entry you selected, every time. The picker lists the models the organisation holds an active, directly-usable credential for; a model that could only run inside a vendor's own tooling is not offered here. Your pick sticks as the default for your next chats.

For models with controllable reasoning depth, the picker's second section sets the effort. The pick rides the conversation — every following turn runs at the level you set, and models without the knob ignore it.

## What the model is given

The prompt is assembled in one fixed order, and the list is short by design: the organisation's mandatory instructions, the assistant's built-in guide, the rules for handling untrusted content, one short line of documentation per tool, then the current timestamp with the response-language directive, then the full message history — including every tool call and result, exactly as they happened.

Nothing else is added. There is no personalisation blob, no memories slipped in behind your back, no automatic knowledge retrieval, and no automatic web context. Everything the model learns beyond its instructions, it learns by calling a tool — which means it shows up in the transcript, attributable and refusable.

<Info>

When the conversation outgrows the model's context window, the oldest messages are dropped and a visible notice takes their place. They are not summarised: a summary is a second model call that can invent the history it was meant to preserve, and dropping messages is lossy in a way you can see.

</Info>

## The three tools

The assistant carries exactly three tools, all read-only retrieval — this is the boundary that keeps chat a conversation rather than a workbench.

| Tool         | What it reaches                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `rag_search` | The organisation's knowledge: documents, knowledge entries, crawled website pages, products, and contacts                        |
| `rag_fetch`  | The full text of one thing a search found — a document by its file id, or a crawled page by its URL                              |
| `web_fetch`  | A public web page, fetched live — only for pages outside the organisation's knowledge; crawled content is served by `rag_search` |

A search is honest about what it covered: the result names every source it searched and says which were unavailable — an organisation without an embedding model configured, for example, gets "documents and crawled pages can't be searched yet" rather than a silent empty list, and the assistant relays that instead of guessing around it.

There is deliberately nothing else — no code execution, no file writing, no connectors, no sub-agents. Those capabilities live on tasks and inside automations, where there is an owner, a review step, and an audit trail sized for them.

## Asking for a deliverable

Ask the assistant for a presentation, a translated document, or any other artifact and it will not half-build one inline: it gives you the short version if one is useful, then tells you to create a task and assign it to an agent. A task has an owner, produces a reviewable result, and only a person marks it done — none of which a chat reply can offer. Translating a sentence you pasted is chat work; translating a file is task work.

## Reading the reply

The reply streams in as it is generated. Above it, the thought timeline records what the assistant did, in order:

- A collapsible **"Thought for _n_ s"** line carries the model's reasoning — click to expand the prose.
- Each tool call is a step row — _Searching knowledge base for "…"_, _Reading example.com_ — with a spinner while it runs and a warning with the reason when it fails. The steps stay visible when the reasoning is collapsed; they are the record of what the assistant reached for.

Below the answer, **Sources** lists the pages and documents the assistant actually loaded — derived from the tool results, not from the prose, so a source card never claims reading that did not happen. Web sources open in a new tab.

The toolbar under a settled reply copies the text, shows token counts and timings, records a thumbs rating, and forks the chat — a visible copy of the conversation up to that point, continued as a new chat of its own.

## Conversations versus chats

Within Chat, the unit is a **chat** — that is the word every button and toast uses. The data model behind it is called `threads` and the URL carries `threads/$threadId`; the docs follow the UI and say "chat" in body prose. The contact-channel inbox an installed email automation adds is a different surface: a conversation there is a contact thread, not a chat — see [Built-in automations](/platform/automations/builtin) for that sense of the word.

## History and search

The chat history sidebar lists every chat you can resume in this org, newest first, with your pinned chats floating on top and project-filed chats under their folders; selecting one opens the full transcript. Searching there filters by title, and full-text search across message bodies is a per-chat operation rather than an org-wide one. Renaming a chat sets a custom title that overrides the generated one. Deleting a chat moves it into [Trash](/platform/admin/governance/trash), where retention sweeps it after the grace window.

## Where this fits

Chat basics is the page the rest of this section refines: [Arena Mode](/platform/chat/arena-mode) runs one prompt through two models side by side, [Voice mode](/platform/chat/voice-mode) covers speaking instead of typing, and [Shared chats](/platform/chat/shared-threads) covers publishing a transcript to the org. If your question turned into work — something with a deliverable at the end — [Agent concepts](/platform/agents/concepts) is the next read: agents do on tasks everything chat deliberately leaves out.
