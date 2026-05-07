---
title: Chat effectively
description: Combine agents, attachments, and dictation into a daily Tale workflow.
---

Most Members use chat the same way every day: pick the right agent, drop in context, ask, iterate. This tutorial walks through that loop end to end so you get answers that are grounded in your organisation's data, not generic model output. It ties together three features you will already see in the UI — the [agent selector](/platform/chat/agents-in-chat), [attachments](/platform/chat/attachments), and dictation — into one workflow you can reuse for real tasks.

The whole flow takes under five minutes once you have done it once. You need Member access or higher, nothing else.

## Step 1 — Pick the right agent

Open **Chat** from the sidebar and click the agent selector at the bottom-left of the composer. The default is the general chat agent, which searches all organisation knowledge. If your team has created specialised agents — a support agent, a legal-review agent, a sales-research agent — switch to one whose knowledge and tools match your task. A narrower agent almost always produces better answers.

If you are not sure which agent to pick, start with the one whose description matches closest. You can switch mid-conversation; the new agent keeps the message history.

## Step 2 — Give it context via attachments

Drop the file or image you want the agent to look at onto the chat window, or click the paperclip icon. Attachments are processed before the message is sent, so the agent can see them when it reads your question. Supported types are listed in [attachments](/platform/chat/attachments) — PDFs, Office documents, images, and most code files.

Attachments stay with the conversation, not the shared knowledge base. If the file is something everyone should be able to ask about later, upload it through the [knowledge base](/platform/workspace/knowledge-base) instead.

## Step 3 — Dictate instead of type when it is faster

If you are walking, summarising a call, or just think faster than you type, click the microphone icon in the composer and speak. Dictation runs in your browser (Web Speech API), so the audio never leaves your device. The transcript appears in the input as you speak; you can edit it before sending.

Dictation is a per-request tool, not a mode — toggle it on, speak, toggle it off, send.

## Step 4 — Iterate on the answer

A first answer is rarely the final one. Use short follow-ups to narrow: "summarise in three bullets", "now in French", "cite the document you used", "rewrite for a non-technical reader". The agent keeps the whole thread in context, so every follow-up benefits from the previous turn.

When you land on a result worth reusing, save it to the [Prompt library](/platform/workspace/prompt-library) — next time, the same starting point is one click away.

## Step 5 — See artifacts in Canvas when it is more than text

If the agent returns a runnable HTML page, an SVG, a Mermaid diagram, or a long markdown document, it creates an **artifact** that auto-opens in the Canvas side pane and lists in the Artifacts bar above the chat. Canvas gives you live preview, source editing, and export — much easier to read than a scrolling chat bubble, and the AI can revise the artifact in place when you ask for fixes. See [Canvas](/platform/workspace/canvas) for the full set of actions.

## Next

- Build an agent tuned for your own team: [First agent end to end](/tutorials/editor/first-agent-end-to-end) (Editor role).
- Learn the shortcut keys: [AI chat — Keyboard shortcuts](/platform/chat/basics#keyboard-shortcuts).
