---
title: Chat basics
description: What happens between hitting send and the reply landing — the composer's choices, what the model is given, the three retrieval tools, and how to read the thought timeline and sources.
---

This page is the mental model for everything in the Chat tab. It names the parts of the composer, traces a message from key-press to streamed reply, says exactly what the model is handed and what it may call along the way, and shows how to read what came back. Read it once and the rest of the chat pages are variations on the same flow.

<Frame caption="The Chat tab with a streamed reply above the composer.">

![A chat thread showing a user question about onboarding feedback and an assistant reply containing a markdown table of three themes.](/images/platform/chat-thread-reply.webp)

</Frame>

## The composer

The composer is the input strip at the bottom of the screen. The message field sends on **Enter** and breaks the line on **Shift+Enter**. One picker beside the `+` menu holds the model choice — **Auto**, the default, lets Tale pick a model per message, or you name one — and, for a named model that exposes it, the reasoning effort. That is the whole set of choices, by design: there is no agent picker, no skill picker, and no control over where the turn runs. The `+` menu holds **Add photos & files** and, on chats that can host one, **Arena Mode** ([Arena Mode](/platform/chat/arena-mode)); **Read replies aloud** ([Voice mode](/platform/chat/voice-mode)) is the speaker toggle beside the microphone, and the microphone dictates into the field.

While a reply streams, the send button becomes stop. Stopping keeps everything that already streamed — the reply settles as it is, mid-sentence if that is where it was.

### Attachments

Drag files from your desktop anywhere onto the composer — an overlay says **Drop files here to upload** while you hover — paste a screenshot straight into the message field, or pick files through the `+` menu's **Add photos & files**. Chat takes images, documents (PDF, Office, OpenDocument, CSV), text-based files, and audio/video. Each image stages as a small thumbnail above the field: click it to zoom, and its ✕ removes it. Everything else stages as a named chip that tracks its processing: the organisation's transcription model turns audio and video into text, and documents are indexed for retrieval. Sending never waits on a progress bar — a message sent while files still process parks above the composer and goes out by itself the moment everything is ready; its ✕ abandons the queued send and puts the text back. Up to ten files ride one message.

Paste a video link (YouTube, Vimeo, Bilibili and friends) and it becomes a chip too: Tale fetches the captions — or extracts and transcribes the audio when there are none — in the background, and the transcript rides your message exactly like an uploaded recording. Only a failed video chip holds the send, because waiting on it would never end: retry it or remove it, everything else queues.

A model that can see images receives the pixels themselves, inline with your words; for one that cannot, the composer says so while the images are staged — that model would only see the file names. Audio never reaches the chat model as bytes: the model receives the transcript as text while your bubble keeps the words you typed (and the audio chip). A document's content reaches the assistant through its knowledge tools — the turn tells it which files are attached and it reads them with `rag_fetch`, so expect a retrieval step before the answer. A format with no text extractor (legacy Office files like `.doc`) still attaches, but the assistant only sees its name and will say so rather than guess.

Documents dropped here stay private to this conversation — they never join the organisation's [Knowledge](/platform/knowledge/overview) library, and no other chat or teammate can retrieve them. Staged files belong to the conversation they were staged in (switching chats clears them), and regenerating a reply re-sends the same attachments — transcripts and document access are rebuilt for the model from the stored files. Work that produces files belongs to a task. Speaking into the microphone is a separate path — see [Voice mode](/platform/chat/voice-mode).

<Frame caption="The composer: message field, the model-and-effort picker, dictation, send.">

![The chat composer with its plus menu, model picker showing Auto, microphone button, and send button.](/images/platform/chat-composer.webp)

</Frame>

## Picking a model

The picker opens on **Auto**: for every message, Tale reads what you wrote — length, code, subject matter — and picks a model for it from the same list the picker shows, favouring a light model for a quick question and a strong one for hard or sensitive ground. A document attachment raises the floor: a message that carries a file to read never goes to the lightest model, however short the question. No second AI decides this (it is a plain heuristic on the message), and there is no silent failover: the model that starts your reply is the one that answers it, and the message details name it. Once a message carries images, only models that can see them are considered; if none can, the send says so instead of guessing.

Prefer to decide yourself? Pick any model from the list — the picker lists the models the organisation holds an active, directly-usable credential for; a model that could only run inside a vendor's own tooling is not offered here. A named pick is yours until you hand it back to Auto, and either choice sticks as the default for your next chats. Auto appears only when there is a real choice to make — with a single usable model the picker simply names it.

For models with controllable reasoning depth, the picker's second section sets the effort. The pick rides the conversation — every following turn runs at the level you set, and models without the knob ignore it. Left on **Default**, a model that can answer without extended reasoning does exactly that — pick a level when you want it to think longer. On Auto the effort section stays out of the menu: how hard a model thinks is paired with _which_ model, so pin one to set it.

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
| `rag_fetch`  | The full text behind a ref — an attached or found document by its file id, or a crawled page by its URL                          |
| `web_fetch`  | A public web page, fetched live — the step beyond the organisation's knowledge; content already crawled is served by `rag_fetch` |

A search is honest about what it covered: the result names every source it searched and says which were unavailable — an organisation without an embedding model configured, for example, gets "documents and crawled pages can't be searched yet" rather than a silent empty list, and the assistant relays that instead of guessing around it.

There is deliberately nothing else — no code execution, no file writing, no connectors, no sub-agents. Those capabilities live on tasks and inside automations, where there is an owner, a review step, and an audit trail sized for them.

## Asking for a deliverable

Ask the assistant for a presentation, a translated document, or any other artifact and it will not half-build one inline: it gives you the short version if one is useful, then tells you to create a task and assign it to an agent. A task has an owner, produces a reviewable result, and only a person marks it done — none of which a chat reply can offer. Translating a sentence you pasted is chat work; translating a file is task work.

## Reading the reply

The reply streams in as it is generated. Above it, the thought timeline records what the assistant did, in order:

- A collapsible **"Thought for _n_ s"** line carries the model's reasoning — click to expand the prose.
- Each tool call is a step row — _Searching knowledge base for "…"_, _Reading example.com_ — with a spinner while it runs and a warning with the reason when it fails. The steps stay visible when the reasoning is collapsed; they are the record of what the assistant reached for.

Below the answer, **Sources** lists the pages and documents the assistant actually loaded — derived from the tool results, not from the prose, so a source card never claims reading that did not happen. Web sources open in a new tab.

The toolbar under a settled reply copies the text, shows token counts and timings (**Send → first words** from Send; **Start → done** and **Start → first token** from when the server begins the reply), records a thumbs rating, and forks the chat — a visible copy of the conversation up to that point, continued as a new chat of its own.

## Conversations versus chats

Within Chat, the unit is a **chat** — that is the word every button and toast uses. The data model behind it is called `threads` and the URL carries `threads/$threadId`; the docs follow the UI and say "chat" in body prose. The contact-channel inbox an installed email automation adds is a different surface: a conversation there is a contact thread, not a chat — see [Built-in automations](/platform/automations/builtin) for that sense of the word.

## History and search

The chat history sidebar lists every chat you can resume in this org, newest first, with your pinned chats floating on top and project-filed chats under their folders; selecting one opens the full transcript. Searching there filters by title, and full-text search across message bodies is a per-chat operation rather than an org-wide one. Renaming a chat sets a custom title that overrides the generated one. Deleting a chat moves it into [Trash](/platform/admin/governance/trash), where retention sweeps it after the grace window.

## Where this fits

Chat basics is the page the rest of this section refines: [Arena Mode](/platform/chat/arena-mode) runs one prompt through two models side by side, [Voice mode](/platform/chat/voice-mode) covers speaking instead of typing, and [Shared chats](/platform/chat/shared-threads) covers publishing a transcript to the org. If your question turned into work — something with a deliverable at the end — [Agent concepts](/platform/agents/concepts) is the next read: agents do on tasks everything chat deliberately leaves out.
