---
title: Chat
description: Chat is where you ask and retrieve — pick a model, send a message, read a reply with its steps and sources visible. This overview maps the screen and draws the line between chat, task, and automation work.
---

Chat is the everyday entry point to Tale. You ask, the assistant searches the organisation's knowledge or fetches a page when the question needs it, and the reply streams back with every step and source on display. Chat deliberately does one job — questions and retrieval. Work that needs an owner and a reviewable result — a presentation, a translated document, a data export — lives on a task; a fixed process lives in an automation. The assistant knows that boundary and points you to a task the moment a request crosses it, so nothing heavy ever gets half-built inside a chat.

<Frame caption="A chat with a streamed reply — the question, the assistant's steps, and the answer.">

![A chat thread showing a user question about onboarding feedback and an assistant reply containing a markdown table of three themes.](/images/platform/chat-thread-reply.webp)

</Frame>

## The parts of the screen

The sidebar lists every chat you can resume, filed under your project folders, pinned favourites first, with search and an archive below. The conversation column carries the exchange: above each reply, a collapsible thinking line records what the assistant did — the reasoning and each knowledge search or page fetch, in order — and below the answer, **Sources** lists what it actually read. The composer at the bottom is the message field plus one picker for the model and its reasoning effort; the `+` menu holds read-aloud and Arena Mode, and the microphone dictates. While a reply streams, send becomes stop.

A fresh chat opens with four starter prompts. Click one and it becomes your first message — the fastest way to see the whole loop run once.

<Frame caption="A new chat: the welcome heading, four starters, and the composer.">

![The empty new-chat screen showing the welcome heading, four conversation starter buttons, and the composer below.](/images/platform/chat-starters-empty.webp)

</Frame>

## Chat, task, or automation?

Match the work to the surface — each kind has exactly one home.

| Kind of work                                                    | Where it lives | Why                                                                    |
| --------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------- |
| Ask about knowledge, documents, or a public web page            | Chat           | Conversation with visible steps and sources; nothing to sign off       |
| Produce a deliverable — a presentation, a translation, a report | Task           | Needs an owner and review; an agent does the work, a person marks Done |
| A fixed process with validation gates and human steps           | Automation     | The process is the product; people and agents act inside it            |

The assistant enforces the first row itself: ask it for a 2000-word essay and it gives you a brief sketch, then tells you to create a task and assign it to an agent. That is by design — a deliverable produced inline in chat would have no review step and no owner.

## Pages in this section

<CardGroup cols="2">

<Card title="Chat basics" icon="message-circle" href="/platform/chat/basics">

What happens between hitting send and the reply landing — the composer, the three retrieval tools, the thought timeline, and sources.

</Card>

<Card title="Arena Mode" icon="swords" href="/platform/chat/arena-mode">

Side-by-side model comparison, and how verdicts roll into feedback analytics.

</Card>

<Card title="Voice mode" icon="mic" href="/platform/chat/voice-mode">

Speaking instead of typing — the STT and TTS handoffs and the privacy boundary.

</Card>

<Card title="Shared chats" icon="share-2" href="/platform/chat/shared-threads">

Sharing a read-only snapshot of a chat with the rest of the org, and stopping the share later.

</Card>

</CardGroup>

## Where this fits

Chat is the asking surface; the rest of the platform is what it asks. Knowledge feeds its searches, and [projects](/platform/projects/overview) file its history and carry the tasks that pick up everything chat deliberately refuses to build inline. The page worth bookmarking first is [Chat basics](/platform/chat/basics) — once you understand the send-to-reply path, every other chat page reads as a variation on it.
