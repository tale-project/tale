---
title: AI chat
description: Use the AI chat assistant to explore data, attach files, and select agents.
---

The AI Chat is the main interface for working with Tale's AI. It is a conversation workspace where you can ask questions, request actions, and explore your data in plain language.

## Using the chat

- Access: Navigate to Chat in the left sidebar.
- To start a new conversation, click the plus icon in the top toolbar or press `Alt + Ctrl + N` (`Option + Cmd + N` on Mac).
- Each conversation is saved to your history and can be searched or renamed later.

## Sending messages

Type in the input area at the bottom of the screen. The Enter key sends your message. Use Shift+Enter for a new line within a message. The input area grows automatically as you type.

## File attachments

You can attach files to any message by clicking the paperclip icon or dragging files into the chat window. Supported file types include:

- Images: PNG, JPEG, GIF, WebP. The agent analyzes the visual content.
- Documents: PDF, DOCX, XLSX, PPTX, TXT, Markdown. The agent reads the content.
- Code files: JS, TS, Python, and most common source file formats.
- Audio: MP3, M4A, WAV, OGG, WebM. The audio is transcribed server-side and the transcript is passed to the agent.
- Video: MP4, MOV, MKV, WebM, AVI, MPEG, 3GP, M4V. The audio track is extracted, transcribed, and passed to the agent — visual content is not sent.

Files are uploaded before the message is sent. A loading spinner shows for each file while it uploads; audio and video attachments also show a transcription status until they finish processing. See [Chat attachments](/platform/chat/attachments) for the full pipeline.

## Selecting an agent

The agent selector is in the bottom-left corner of the input area, shown as a bot icon. Use it to choose which AI agent handles your conversation. The default is the system chat agent. Custom agents your team has built also appear here.

## Chat history

Click the clock icon in the top toolbar to open the history sidebar. You can:

- Browse all past conversations, grouped by date
- Click a conversation to open it
- Double-click a conversation title to rename it inline
- Use the three-dot menu to rename or delete a conversation
- Search across all conversations with `Ctrl+K` or `Cmd+K` on Mac

## What the chat agent can do

The default chat agent can handle:

| Tool category         | What you can ask                                                         |
| --------------------- | ------------------------------------------------------------------------ |
| Knowledge base search | Ask questions answered by your uploaded documents and crawled websites   |
| Web search            | Search the internet for current information                              |
| Document handling     | Parse and analyze PDF, Word, PowerPoint, Excel, and text files           |
| Image analysis        | Describe, analyze, or extract information from images                    |
| Audio transcription   | Transcribe attached audio or video files so the agent can summarise them |

## Arena mode

Arena Mode lets you compare two AI models on the same prompt. Click the **Swords** icon in the input toolbar, select two models, and send a message. Both models respond in parallel in a split view. Record a verdict to mark which response was better.

See [Arena mode](/platform/chat/arena-mode) for full details.

## Canvas

When the AI generates a code block, HTML snippet, Mermaid diagram, or markdown, click **Open in Canvas** to view it in a dedicated side pane. Canvas provides syntax highlighting, live preview, editing, and export. You can edit content and apply changes back to the conversation.

See [Canvas](/platform/workspace/canvas) for full details.

## Prompt library

Save and reuse prompt templates across your organization. Open the Prompt Library from the chat input toolbar to browse, search, and insert saved prompts. You can also save any chat message as a prompt template directly from the conversation.

See [Prompt library](/platform/workspace/prompt-library) for full details.

## Keyboard shortcuts

| Action                 | Windows / Linux  | macOS              |
| ---------------------- | ---------------- | ------------------ |
| New chat               | `Alt + Ctrl + N` | `Option + Cmd + N` |
| Search chats           | `Ctrl + K`       | `Cmd + K`          |
| Toggle history sidebar | `Ctrl + H`       | `Cmd + H`          |
