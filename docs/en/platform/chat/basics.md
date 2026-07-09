---
title: Chat basics
description: What happens between you hitting Send and the reply landing — composer, agent pick, model resolution, streaming, citations, and how a chat is stored.
---

This page is the mental model for everything in the Chat tab. It names the parts of the composer, traces a message from key-press to streamed reply, and explains how a chat is stored once it lands — read it once and the rest of the chat pages are variations on the same flow.

<Frame caption="The Chat tab with a streamed reply above the composer.">

![A chat thread showing a user question about onboarding feedback and an assistant reply containing a markdown table of three themes.](/images/platform/chat-thread-reply.webp)

</Frame>

## The composer

The composer is the input strip at the bottom of the screen. Three controls matter: the agent picker on the left, the model picker beside it, and the message field with send on the right. Attachments come in via paste, drag-and-drop, or the attach control — see [Attachments](/platform/chat/attachments) for what is accepted.

<Frame caption="The composer's three controls — agent picker, model picker, message field.">

![The chat composer strip with agent picker, model picker, and send button.](/images/platform/chat-composer.webp)

</Frame>

## Picking an agent

The agents picker filters by name as you type; the default is an agentless **Assistant** that uses the org's default chat model and no extra knowledge or tools. Picking an agent before the first message makes the agent sticky for the whole chat; picking one mid-chat applies from the next message onward.

<Note>

There is no "back to no agent" toggle — pick **Assistant** to revert. The full rules live in [Agents in chat](/platform/chat/agents-in-chat).

</Note>

## Picking a model

The model picker lists what the agent (or the org, when no agent is picked) allows. Each model carries a tag — **Chat**, **Vision**, **Image generation**, **Embedding** — that signals what it is good for. **Auto** picks the agent's primary; when the primary is rate-limited or unavailable, Tale falls back through the agent's failover order.

<Warning>

Picking a non-vision model when the message includes an image silently drops the image — the reply reads as if the image was never sent.

</Warning>

## Reading the reply

The reply streams in token by token. When the agent reasons before answering, a collapsible thinking line appears above the reply. Tool calls render as collapsed boxes you can expand to read what the agent did; **Run code** output lands in the Canvas on the right, as **Code output** in its file tree. When the agent retrieves knowledge, citations attach to the sentences they support — hovering over a citation shows the source title, clicking opens the source. The agent's instructions never appear in the rendered reply; they sit one layer down, shaping behaviour rather than text.

## Questions from the agent

An agent with the human-input tool can pause mid-task and ask you something — a **Question** card appears in the chat with the fields the agent needs, and generation waits until you answer. Fill the form and click **Submit response**, or click **Reply differently** to push back in free text instead. If your answer was wrong or incomplete, click **Edit response** on the answered card — the form reopens prefilled, and **Update response** re-runs the agent with the corrected answer superseding the old one. The card keeps every previous answer: flip through the versions with the arrows next to the response, the way edited messages work.

## Conversations versus chats

Within Chat, the unit is a **chat** — that is the word every button and toast uses. The data model behind it is called `threads`, and the URL slug is `threads/$threadId`; the docs follow the UI and say "chat" in body prose. The customer-channel inbox an installed email automation adds is a different surface — a conversation there is a customer thread, not a chat; see [Built-in automations](/platform/automations/builtin) for the inbox sense.

## History and search

**Show chats** above the composer opens the history sidebar — every chat you can resume in this org, newest first; selecting one opens the full transcript. Searching there filters by title; full-text search across message bodies is a per-chat operation, not org-wide. Renaming a chat sets a custom title that overrides the model-generated one; deleting a chat moves it into [Trash](/platform/admin/governance/trash), where retention sweeps it after the grace window.

## Where this fits

Chat basics is the page everything else in this section refines: [Agents in chat](/platform/chat/agents-in-chat) goes deeper on the picker, [Attachments](/platform/chat/attachments) on what the upload does, [Voice mode](/platform/chat/voice-mode) on the STT and TTS handoffs around the same composer. If you came here to build an agent rather than use one, jump to [Agent concepts](/platform/agents/concepts) — the four-knob mental model is the foundation every chat with an agent depends on.
