---
title: Attachments
description: Supported file types, where uploads land, when content is RAG-indexed and when it is pasted verbatim into the prompt.
---

Attachments let a chat reference a file without bouncing you to another tab. You paste, drag in, or pick **Add photos & files** from the composer's plus menu; the file rides along with the message and Tale routes it to the right pipeline. Most file types land verbatim in the model's input; large or structured files are indexed and excerpted.

This page covers the upload mechanic on the composer only. Documents uploaded into [Knowledge](/platform/knowledge/documents) follow a separate flow with persistent indexing — chat attachments are scoped to the chat that received them.

## A worked upload

Paste a PDF into the composer. The composer surfaces a chip with the filename and a spinner; the chip becomes **Uploaded** once the file has landed on Tale's storage. **Send** the message, and the agent receives an extracted-text view of the PDF inline with your prompt. If the file is larger than the inline-context budget, Tale indexes it and the agent reads chunks on demand via its retrieval tool.

## Supported types

Three families: **images**, **structured documents** (PDF, DOC/DOCX, ODT, XLS/XLSX, PPT/PPTX), and **text-like files** (plain text, markdown, source code, CSV, JSON, YAML). Images go to the vision model the chat is using; the model picker must be on a vision-capable model or the image will silently drop. Structured documents are extracted to text — diagrams, scanned pages, and embedded objects are best-effort. Text-like files land verbatim.

## Where uploads live

Each attachment is stored in Tale's object store and bound to the chat that received it, and it is also copied into the chat's sandbox workspace at `/user/uploads/<name>`. That second copy is what the agent's `file_read`, `file_list`, and `run_code` tools operate on — the real bytes, not just the extracted-text view that rides inline with your prompt. Deleting the chat moves the attachments into [Trash](/platform/admin/governance/trash) with the message history; restoring brings them back. There is no separate "chat attachments" library — to share a document across many chats, upload it to [Knowledge](/platform/knowledge/documents) and bind it to an agent.

## RAG versus verbatim

Small text files and structured documents under the agent's inline budget are pasted verbatim. Larger ones are chunked, embedded, and indexed; the agent retrieves the relevant chunks at reply time and cites them. The boundary depends on the model — long-context models swallow more whole. When the agent retrieves from an attachment rather than reading it whole, the citations point to chunk ranges in the original file.

## Referencing knowledge documents with @

<Frame caption="Typing @ opens the knowledge-base picker over the composer.">

![The chat composer with an at-sign typed and the knowledge-base picker open, listing three indexed text documents.](/images/platform/chat-mention-picker.webp)

</Frame>

Typing `@` in the composer opens a picker over the org's indexed knowledge, split into a **Documents** section and a **Folders** section. Type to filter by name; `@file` pins one document under a **Knowledge** chip, and `@folder` pins a folder and everything indexed under it under a **Folder** chip. On send, Tale checks your access, scopes that reply's retrieval to exactly the pinned items — a folder expands to its subtree's files — and injects the relevant passages even when the agent's knowledge mode is off, since an explicit mention outranks the agent's retrieval configuration. Up to five items, documents and folders combined, can be pinned per message.

The chips are the source of truth: deleting the `@Title` text from the message does not unpin the reference — remove the chip instead. The picker only offers documents that have finished indexing and that your teams can access. Inside a project chat it also lists that project's own files and folders, ranked first; a project's files stay scoped to the project and never surface in the `@` picker of a chat outside it — see [Manage project files](/platform/projects/manage-files). The reference is per-message; a follow-up without mentions falls back to the agent's normal knowledge scope.

## Where this fits

Attachments are the lightweight, chat-scoped way to bring a file into a reply. The heavyweight, org-scoped equivalent is [Documents](/platform/knowledge/documents) — same indexing pipeline, but bound to agents instead of a single chat. The page worth reading next depends on what you are trying to do — if the file matters once, attach it here; if it will matter again, upload it to Knowledge and let an agent reference it from every chat.
