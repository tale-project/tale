---
title: AI chat
description: The conversation workspace where you ask questions, attach files, pick an agent, and watch the AI work through a multi-step plan in plain language.
---

Chat with AI is Tale's main conversational surface. You ask questions, attach files, pick an agent, and watch the AI work — searching the knowledge base, calling integrations, building artifacts in the Canvas pane, walking a multi-step plan when the question is broad. It's the surface every role in the product touches first, from a Member asking a one-off question to a Developer testing the agent they just published.

This page covers the composer, the surrounding panes, and the keyboard reach. The deeper features each have their own page: attachments handling, the agent picker, Arena Mode for model comparison, Canvas for editable artifacts, the Prompt library, and the Research-plan side pane.

## Open a conversation

Chat is the first item in the left sidebar. To start a new conversation, click the plus icon in the top toolbar or press `Alt + Ctrl + N` (`Option + Cmd + N` on macOS). Every conversation is saved automatically and searchable from the history sidebar.

## Send messages

The composer sits at the bottom of the screen. Press `Enter` to send; `Shift + Enter` inserts a newline within the same message. The composer grows as you type — there's no hard length limit beyond the model's context window.

## Attach files

To send a file with a message, click the paperclip icon or drag the file into the composer. Tale processes the upload before the message is sent — a spinner shows per file, with a separate transcription status for audio and video.

The supported file types are:

- **Images:** PNG, JPEG, GIF, WebP. The agent analyses the visual content.
- **Documents:** PDF, DOCX, XLSX, PPTX, TXT, Markdown. The agent reads the extracted text.
- **Code files:** JavaScript, TypeScript, Python, and the common source-file formats.
- **Audio:** MP3, M4A, WAV, OGG, WebM. The audio is transcribed server-side and the transcript is passed to the agent.
- **Video:** MP4, MOV, MKV, WebM, AVI, MPEG, 3GP, M4V. The audio track is extracted, transcribed, and passed to the agent — visual content is not sent.

The full pipeline (size limits, PII handling, transcription billing) lives at [Chat attachments](/platform/chat/attachments).

## Pick an agent

The agent selector is the bot icon in the bottom-left of the composer. To route a conversation through a specific agent, open the selector and pick it — the default is the system chat agent that ships with Tale; custom agents your team has built appear below it. Switching the agent mid-conversation is allowed; the new agent reads the existing transcript before answering.

The agent's instructions, knowledge scope, and enabled tools determine what the chat can do. See [Using agents in chat](/platform/chat/agents-in-chat) for the runtime behaviour, and [Agent concepts](/platform/agents/concepts) for the mental model behind the four knobs.

## Browse chat history

The clock icon in the top toolbar opens the history sidebar. From there you can:

- Browse all past conversations, grouped by date.
- Click a conversation to open it.
- Double-click a title to rename it inline.
- Use the three-dot menu to rename, archive, or delete.
- Search across every conversation with `Ctrl + K` (or `Cmd + K` on macOS).

## What the default chat agent can do

The agent that ships with Tale is wired with the broadest set of tools so a fresh tenant has something useful out of the gate:

| Tool category         | What you can ask                                                          |
| --------------------- | ------------------------------------------------------------------------- |
| Knowledge-base search | Questions answered by your uploaded documents and crawled websites.       |
| Web search            | Current information from the public internet.                             |
| Document handling     | Parse and analyse PDF, Word, PowerPoint, Excel, and text files inline.    |
| Image analysis        | Describe, analyse, or extract information from attached images.           |
| Audio transcription   | Transcribe attached audio or video files so the agent can summarise them. |

Custom agents you build start with the same defaults and you narrow them — see [Create an agent](/platform/agents/create).

## Arena Mode

Arena Mode runs the same prompt through two models in parallel and shows the responses side by side. To compare models on a real prompt, click the **Swords** icon in the input toolbar, pick two models, and send a message — both responses stream into a split view. Record a verdict to flag which response was better; the verdicts accumulate as a per-model comparison record.

The full doctrine lives at [Arena Mode](/platform/chat/arena-mode).

## Canvas

When the AI generates a runnable HTML page, an SVG, a Mermaid diagram, a Markdown document, or a code snippet, it creates an **artifact** — a card in the Artifacts bar above the chat that auto-opens in the Canvas pane. To edit an artifact in place, open the Canvas pane and either ask the AI for a revision or hand-edit the source; the AI can revise iteratively across turns, so small fixes don't require regenerating the whole document.

The full doctrine lives at [Canvas](/platform/workspace/canvas).

## Prompt library

To reuse a prompt template across the team, open the Prompt library from the composer toolbar — every saved prompt is searchable and insertable with one click. To save the prompt you just wrote, open the message's three-dot menu and pick **Save to library**; scope it to yourself, your team, or the whole organisation.

The full doctrine lives at [Prompt library](/platform/workspace/prompt-library).

## Research plan

For multi-step questions that need planning — broad research, comparisons across many sources, summaries that pull from several documents and the web — the agent breaks the work into a **Research plan** and walks through it step by step. The plan opens automatically as a side pane the first time the agent emits a todo for the conversation; you can pin it open or close it from the strip on the right edge of the chat.

Each todo shows a status (pending, running, done, failed), a one-line summary, and the sources the agent has captured for that step — knowledge-base hits, retrieved web pages, integration results. The plan updates live as the agent finishes each step, so you watch the reasoning unfold instead of waiting for one long answer at the end.

You can intervene without breaking the run:

- **Collapse a step** to hide its sources when the list gets long.
- **Reorder** by sending a follow-up message — the agent revises remaining todos based on your feedback.
- **Stop** with the composer's stop button — partial results stay in the thread, and the failed-todo count is shown at the top of the plan.

The Research plan is read-only — you don't edit todos directly. Steer the run with regular chat messages.

## Keyboard shortcuts

| Action                 | Windows / Linux  | macOS              |
| ---------------------- | ---------------- | ------------------ |
| New chat               | `Alt + Ctrl + N` | `Option + Cmd + N` |
| Search chats           | `Ctrl + K`       | `Cmd + K`          |
| Toggle history sidebar | `Ctrl + H`       | `Cmd + H`          |

## Where this fits

Chat is the front door for everything the AI can do — the same agents, knowledge, and tools every other surface uses are reachable from the composer. Most readers live in this one page; the rest of the platform reads as either _how to make chat better_ (curating the knowledge base, building agents) or _what to do when chat isn't the right surface_ (automations for unattended work, the API for scripts).

To make chat more useful for the team, the natural next step is to build a purpose-built agent — start with [Agent concepts](/platform/agents/concepts) for the mental model, then walk through [Build your first agent end to end](/tutorials/editor/first-agent-end-to-end).
