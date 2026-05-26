---
title: Canvas pane
description: When the Canvas pane opens, what gets a Canvas versus inline rendering, and how the Canvas content stays with the chat across visits.
---

The **Canvas** is a second pane that opens to the right of the chat thread. It appears when the reply contains content the linear thread cannot hold well — a long code block, a Mermaid diagram, a structured document, a runnable Python script. Inline replies stay short and readable; everything else moves out of the way.

The Canvas is not a separate document area or a richer composer. It is a render destination — the agent decides what goes there based on the shape of its output, and the user sees it without having to ask.

## What the Canvas is

The Canvas opens automatically the first time a reply produces Canvas-worthy content. The thread keeps a short pointer ("Source", "Preview") at the spot in the conversation where the Canvas content was generated; the right-hand pane holds the actual content. Toggle between **Source** and **Preview** at the top of the Canvas to read raw code or see the rendered result; **Download** saves the current Canvas content to a file.

## When it auto-opens

The Canvas opens for several render kinds the inline thread would crowd: **Code** (any language), **HTML**, **Mermaid** diagrams, **SVG**, long **Markdown** documents the agent produced, and runnable scripts — **Python (sandbox)**, **Node (sandbox)**, **Script (sandbox)**. Run-code outputs land in the Canvas alongside the script so a single pane shows code and result. Short snippets the inline thread can hold do not trigger the Canvas — the threshold is rough but consistent across kinds.

## Editing in the Canvas

The Canvas is a render surface for whatever the agent produced. Editing the rendered content means asking the agent to revise it — a follow-up message in the thread ("change the timeout to 30 seconds", "make the diagram horizontal") triggers a new generation that replaces the Canvas content. There is no direct-edit mode; the agent owns what is in the Canvas.

## Persistence across the chat

The Canvas content is part of the chat, not a separate file. Reopening the chat later reopens the Canvas with the latest content; switching to another chat closes the Canvas pane until that chat produces or carries Canvas content of its own. Sharing the chat with **Share chat** carries the Canvas across — the viewer sees the same Source / Preview toggle, in read-only mode.

## Where this fits

The Canvas is the answer to "what happens when the reply is too big for the thread". It composes with everything else in Chat — agents, attachments, voice, shared chats — without those features needing to know about it. The next read that sometimes matters: [Build a custom tool](/tutorials/developer/build-a-custom-tool) walks an agent that produces runnable Python in the Canvas, end to end, on a fresh instance.
