---
title: Chat with AI
description: The conversational workspace where you ask questions, attach files, pick an agent, and watch a multi-step plan unfold in plain language.
---

Chat with AI is Tale's main conversational surface — the place where every role in the product first meets the AI. You write a question in the composer at the bottom of the screen, optionally attach files or pick a specialised agent, and the AI works through the answer in plain language: searching the knowledge base, calling integrations, building artifacts in the Canvas pane, walking a multi-step plan when the question is broad. This page covers the composer itself, the surrounding panes, and the keyboard reach.

The deeper features each have their own page. Attachments handling, the agent picker, Arena Mode for model comparison, Canvas for editable artifacts, the Prompt library, and the Research plan side pane all live one click away in the sidebar.

## Open a conversation

Chat with AI is the first item in the left sidebar. To start a new conversation, click the plus icon in the top toolbar or press `Alt + Ctrl + N` (`Option + Cmd + N` on macOS). Every conversation saves automatically the moment you send the first message, so closing the browser mid-thought never loses work.

## Send messages

The composer sits at the bottom of the screen. Press `Enter` to send the message; `Shift + Enter` inserts a newline within the same message. The composer grows as you type — there's no hard length limit beyond the model's context window. Click **Stop generating** to interrupt the AI mid-reply; partial output stays in the thread, so you keep whatever is already useful.

## Attach files

To send a file with a message, click the paperclip icon or drag the file onto the composer. Tale processes the upload before the message reaches the model — a spinner shows per file, with a separate transcription status for audio and video. The full set of accepted formats:

- **Images:** PNG, JPEG, GIF, WebP. The agent analyses the visual content.
- **Documents:** PDF, DOCX, XLSX, PPTX, TXT, Markdown. The agent reads the extracted text.
- **Code files:** JavaScript, TypeScript, Python, and the common source-file formats.
- **Audio:** MP3, M4A, WAV, OGG, WebM. The audio track is transcribed server-side and the transcript is passed to the agent.
- **Video:** MP4, MOV, MKV, WebM, AVI, MPEG, 3GP, M4V. The audio track is extracted, transcribed, and passed to the agent — visual content is not sent.

The full pipeline (size limits, transcription billing, PII handling) lives at [Chat attachments](/platform/chat/attachments).

## Pick an agent

The agent selector is the bot icon in the bottom-left of the composer. To route a conversation through a specific agent, open the selector and pick it — the default is the system assistant that ships with Tale; custom agents your team has built appear below it. Switching the agent mid-conversation is allowed, and the new agent reads the existing transcript before its first reply.

The agent's instructions, knowledge scope, and enabled tools determine what the chat can do. The runtime behaviour for swapping agents and reading conversation starters lives at [Using agents in chat](/platform/chat/agents-in-chat); the mental model behind the four knobs lives at [Agent concepts](/platform/agents/concepts).

## Browse history

The clock icon in the top toolbar opens the History sidebar. Past conversations are grouped by date — click one to open it, double-click a title to rename it inline, or use the three-dot menu to archive or delete. To search across every conversation, press `Ctrl + K` (`Cmd + K` on macOS) and type — subject and message bodies are indexed.

## What the default assistant can do

The agent that ships with Tale is wired with the broadest set of tools so a fresh organisation has something useful out of the gate. The five tool categories on the default Assistant:

| Tool category         | What you can ask                                                          |
| --------------------- | ------------------------------------------------------------------------- |
| Knowledge-base search | Questions answered by your uploaded documents and crawled websites.       |
| Web search            | Current information from the public internet.                             |
| Document handling     | Parse and analyse PDF, Word, PowerPoint, Excel, and text files inline.    |
| Image analysis        | Describe, analyse, or extract information from attached images.           |
| Audio transcription   | Transcribe attached audio or video files so the agent can summarise them. |

Custom agents you build start with the same defaults; you narrow them. The build flow walks the steps at [Create an agent](/platform/agents/create).

## Arena Mode

Arena Mode runs the same prompt through two models in parallel and shows the responses side by side. To compare models on a real prompt, click the **Swords** icon in the input toolbar, pick two models, and send a message — both responses stream into a split view. Record a verdict to flag which response was better; the verdicts accumulate as a per-model comparison record under usage analytics.

The full doctrine lives at [Arena Mode](/platform/chat/arena-mode).

## Canvas

When the AI produces runnable HTML, an SVG, a Mermaid diagram, a Markdown document, or a code snippet, it creates an **artifact** — a card in the Artifacts bar above the chat that auto-opens in the Canvas pane. The artifact has a stable identity across the whole conversation, so small fixes don't require regenerating the whole document — the AI patches it in place across turns.

The full doctrine lives at [Canvas](/platform/workspace/canvas).

## Prompt library

To reuse a prompt template across the team, open the Prompt library from the composer toolbar — every saved prompt is searchable and insertable with one click. To save the prompt you just wrote, open the message's three-dot menu and pick **Save as prompt**; scope it to yourself, your team, or the whole organisation.

The full doctrine lives at [Prompt library](/platform/workspace/prompt-library).

## Research plan

Broad questions that need planning — multi-source research, comparisons, summaries across several documents and the web — get broken into a **Research plan**. The plan opens automatically as a side pane the first time the agent emits a todo for the conversation; pin it open from the strip on the right edge of the chat, or close it when you want the full message stream back.

Each todo shows a status (pending, running, done, failed), a one-line summary, and the sources the agent has captured for that step — knowledge-base hits, retrieved web pages, integration results. The plan updates live as the agent finishes each step, so you watch the reasoning unfold instead of waiting for one long answer at the end.

You can intervene without breaking the run. Collapse a step to hide its sources when the list grows long. Reorder by sending a follow-up message — the agent revises remaining todos based on your feedback. Stop with the composer's stop button — partial results stay in the thread, and the failed-todo count shows at the top of the plan. The plan itself is read-only; steer the run with regular chat messages.

## Keyboard shortcuts

| Action                 | Windows / Linux  | macOS              |
| ---------------------- | ---------------- | ------------------ |
| New chat               | `Alt + Ctrl + N` | `Option + Cmd + N` |
| Search chats           | `Ctrl + K`       | `Cmd + K`          |
| Toggle History sidebar | `Ctrl + H`       | `Cmd + H`          |

## Where this fits

Chat is the front door for everything the AI can do. The agents, the knowledge, the tools — every other surface in Tale either feeds the chat (curating the knowledge base, building agents, configuring providers) or replaces it for cases where the chat shape is wrong (automations for unattended work, the API for scripts). Most readers live in this one page; the rest of the platform reads as either _how to make chat better_ or _what to do when chat isn't the right surface_.

To make chat sharper for the team, the natural next step is a purpose-built agent — start with [Agent concepts](/platform/agents/concepts) for the mental model, then walk through [Build your first agent end to end](/tutorials/editor/first-agent-end-to-end).
