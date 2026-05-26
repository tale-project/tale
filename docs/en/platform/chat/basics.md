---
title: Chat basics
description: What happens between you hitting Send and the reply landing — composer, agent pick, model resolution, streaming, citations, and how a chat is stored.
---

This page is the mental model for everything in the Chat tab. It names the parts of the composer, traces a single message from key-press to streamed reply, and explains how a chat is stored once it lands. Once you have read it, the rest of the chat pages read as variations on the same flow.

The flow is mostly invisible — Tale stitches a half-dozen subsystems together to make a chat feel like a single conversation — but the seams matter when something behaves unexpectedly. Knowing which subsystem owns which step is the difference between filing a useful bug report and a vague one.

## The composer

The composer is the input strip at the bottom of the screen. Three controls matter: the agent picker on the left, the model picker beside it, and the textarea with **Send** on the right. The agent picker exposes every agent the org has marked **Visible in chat**, plus a default **Assistant** when no agent is picked. The model picker exposes every chat-tagged model the agent's policy allows; **Auto** lets Tale resolve at request time. Attachments come in via paste, drag-and-drop, or the upload control — see [Attachments](/platform/chat/attachments) for what is accepted.

## The agents picker

The agents picker filters by name as you type; the default is an agentless **Assistant** that uses the org's default chat model and no extra knowledge or tools. Picking an agent before the first message makes the agent sticky for the whole chat; picking one mid-chat applies it to the next message and everything after. There is no "back to no agent" toggle — pick **Assistant** to revert. The [Agents in chat](/platform/chat/agents-in-chat) page covers the rules in detail.

## The model picker

The model picker lists models the agent (or the org, when no agent is picked) is allowed to use. Each model carries a tag — **Chat**, **Vision**, **Image generation**, **Embedding** — that signals what it is good for. Picking a vision model when the message has no image is fine; picking a non-vision model when the message includes an image will silently drop the image. **Auto** picks the agent's primary; when the primary is rate-limited or unavailable, Tale falls back to whatever the agent's failover order names.

## Reply rendering and citations

The reply streams in token by token. Tool calls render as collapsed boxes the user can expand to read what the agent did; **Run code** outputs land in the Canvas on the right. When the agent retrieves knowledge, citations attach to the sentences they support — hovering over a citation shows the source title; clicking opens the source. The agent's instructions never appear in the rendered reply; they sit one layer down, shaping behaviour rather than text.

## Conversations versus chats

Within Chat, the unit is a **chat** — that is the word every button and toast uses. The data model behind it is called `threads`, and the URL slug is `threads/$threadId`; the docs follow the UI and say "chat" in body prose. The separate **Conversations** tab (one over in the sidebar) is the customer-channel inbox, not a list of chats. Two senses of "conversation", two surfaces — see [Conversations overview](/platform/conversations/overview) for the inbox sense.

## History and search

**History** is the list of every chat the user can resume in this org. New chats appear at the top; selecting one opens the full transcript. **Search chat** filters History by title; full-text search across message bodies is a per-chat operation, not org-wide. **Rename chat** sets a custom title that overrides the model-generated one; **Delete chat** moves the chat into [Trash](/platform/admin/governance/trash) where retention sweeps it after the grace window.

## Where this fits

Chat basics is the page everything else in this section refines: [Agents in chat](/platform/chat/agents-in-chat) goes deeper on the picker, [Attachments](/platform/chat/attachments) on what the upload does, [Voice mode](/platform/chat/voice-mode) on the STT and TTS handoffs around the same composer. If you came here to build an agent rather than use one, jump to [Agent concepts](/platform/agents/concepts) — the four-knob mental model is the foundation every chat with an agent depends on.
