---
title: Canvas pane
description: When the Canvas pane opens, what gets a Canvas versus inline rendering, and how the Canvas content stays with the chat across visits.
---

The **Canvas** is a second pane that opens to the right of the chat thread. It appears when the reply contains content the linear thread cannot hold well — a long code block, a Mermaid diagram, a structured document, a runnable Python script. Inline replies stay short and readable; everything else moves out of the way.

The Canvas is not a richer composer, and it is not a place you edit by hand. It is a live view of the chat's workspace — the files the agent writes, the files you upload, and the files code runs produce — surfaced without your having to ask.

## What the Canvas is

The Canvas opens automatically the first time a reply produces Canvas-worthy content. It has two parts: a file tree on the left and a viewer on the right. The tree groups the chat's workspace files by where they came from — **AI files** the agent wrote (`/user/code`), **Uploaded** files you attached or `@`-pinned (`/user/uploads`), and **Code output** a run produced (`/user/output`); empty groups are hidden. Pick a file and it opens in the viewer, where you toggle between **Source** and **Preview** to read raw code or see the rendered result, and **Download** saves that file.

## When it auto-opens

The Canvas opens for several render kinds the inline thread would crowd: **Code** (any language), **HTML**, **Mermaid** diagrams, **SVG**, long **Markdown** documents the agent produced, and runnable scripts — **Python (sandbox)**, **Node (sandbox)**, **Script (sandbox)**. `run_code` executes over the chat's shared workspace — it reads scripts the agent wrote under `/user/code` and harvests whatever the run leaves in `/user/output`, so results surface as **Code output** rows in the file tree, not just beside the script; a run can also install packages on their own as a separate step, showing **Installing dependencies** while it works. Only agent-written and code-output files auto-open the Canvas — files you upload appear in the tree but do not grab the screen. Short snippets the inline thread can hold do not trigger the Canvas — a twenty-line script renders inline with its own **Copy** control, as below.

<Frame caption="A short script stays inline — the Canvas is for output that outgrows the thread.">

![A chat reply containing a syntax-highlighted Python code block rendered inline with a Copy button, without the Canvas pane opening.](/images/platform/chat-code-reply.webp)

</Frame>

## Editing in the Canvas

The Canvas is a render surface for whatever the agent produced. Editing the rendered content means asking the agent to revise it — a follow-up message in the thread ("change the timeout to 30 seconds", "make the diagram horizontal") triggers a new generation that replaces the Canvas content. There is no direct-edit mode; the agent owns the files it writes, and the files you upload stay exactly as you sent them.

## Persistence across the chat

The Canvas content is part of the chat, not a separate file. Reopening the chat later reopens the Canvas with the latest content; switching to another chat closes the Canvas pane until that chat produces or carries Canvas content of its own. Sharing the chat with **Share chat** carries the Canvas across — the viewer sees the same Source / Preview toggle, in read-only mode.

## Where this fits

The Canvas is the answer to "what happens when the reply is too big for the thread". It composes with everything else in Chat — agents, attachments, voice, shared chats — without those features needing to know about it. The next read that sometimes matters: [Build a custom tool](/tutorials/developer/build-a-custom-tool) walks an agent that produces runnable Python in the Canvas, end to end, on a fresh instance.
