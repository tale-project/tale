---
title: Shared chats
description: Sharing a chat with others in your organization via a link, forking a shared chat into your own, and the read-only banner the viewer sees.
---

Sharing a chat creates a link that anyone in your organization can open. The viewer sees the full transcript in read-only mode; they cannot reply, but they can fork the chat into one of their own and continue from there. The mechanic is light enough to use casually — share a question and its answer the way you would share a document.

This page covers the sharing surface end to end: enabling sharing, who the link works for, the read-only view, and the fork gesture that turns "I want to follow up" into a new chat.

## Sharing a chat

Click **Share** in the chat's header. The **Share chat** dialog offers **Enable sharing** as a toggle and, once enabled, the share link with **Copy link** and **Preview** — the latter opens the read-only view the recipient will see. Paste the link into the channel your team uses.

<Frame caption="The Share chat dialog — org-scoped link, copy, and preview.">

![The Share chat dialog over a chat, showing the Enable sharing toggle switched on, the share link, and Copy link and Preview buttons.](/images/platform/chat-share-dialog.webp)

</Frame> **Anyone in your organization with the link can view this chat** — the link is scoped to the org, not the wider internet. Disabling sharing later invalidates the link; visitors land on a not-found page.

## What the viewer sees

The viewer opens the link and lands on the chat with a banner: **You are viewing a shared chat in read-only mode**. The transcript reads exactly as the author sees it, including tool calls and citations. The composer is replaced with a single hint — **Sending a message will create your own copy of this chat** — that is the only path forward.

## Forking a shared chat

The viewer's only write action on a shared chat is **Fork this chat**. The fork creates a new chat owned by the viewer, with the full transcript copied across as context. The original is unchanged; the fork has no link back to the original beyond the messages it inherits. From the viewer's side the fork is now an ordinary chat — sticky agent picks, model picks, and tools all behave as they would in any chat the viewer started themselves.

## When the link goes stale

Disabling sharing invalidates the link. Deleting the source chat sends it to [Trash](/platform/admin/governance/trash) and the link breaks; restoring the chat from Trash does not restore the link — the author re-enables sharing if it is needed again. Existing forks are unaffected by either action because they are independent chats.

## Where this fits

Shared chats are the lightweight way to hand a chat to a teammate without leaving the product. The heavier-weight alternative is bringing the teammate into a [Project](/platform/projects/overview) where chats, files, and agents are shared by default. Sharing is for one-off handoffs; a Project is for ongoing collaboration on the same work.
