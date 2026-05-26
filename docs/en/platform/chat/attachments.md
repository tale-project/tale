---
title: Attachments
description: Supported file types, where uploads land, when content is RAG-indexed and when it is pasted verbatim into the prompt.
---

Attachments let a chat reference a file without bouncing the user to another tab. You paste, drag in, or click the upload control on the composer; the file rides along with the message and Tale routes it to the right pipeline. Most file types land verbatim in the model's input; large or structured files are indexed and excerpted.

This page covers the upload mechanic on the composer only. Documents uploaded into [Knowledge](/platform/knowledge/documents) follow a separate flow with persistent indexing — chat attachments are scoped to the chat that received them.

## A worked upload

Paste a PDF into the composer. The composer surfaces a chip with the filename and a spinner; the chip becomes **Uploaded** once the file has landed on Tale's storage. **Send** the message, and the agent receives an extracted-text view of the PDF inline with your prompt. If the file is larger than the inline-context budget, Tale indexes it and the agent reads chunks on demand via its retrieval tool.

## Supported types

Three families: **images**, **structured documents** (PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX), and **text-like files** (plain text, markdown, source code, CSV, JSON, YAML). Images go to the vision model the chat is using; the model picker must be on a vision-capable model or the image will silently drop. Structured documents are extracted to text — diagrams, scanned pages, and embedded objects are best-effort. Text-like files land verbatim.

## Where uploads live

Each attachment is stored in Tale's object store and bound to the chat that received it. Deleting the chat moves the attachments into [Trash](/platform/admin/governance/trash) with the message history; restoring brings them back. There is no separate "chat attachments" library — to share a document across many chats, upload it to [Knowledge](/platform/knowledge/documents) and bind it to an agent.

## RAG versus verbatim

Small text files and structured documents under the agent's inline budget are pasted verbatim. Larger ones are chunked, embedded, and indexed; the agent retrieves the relevant chunks at reply time and cites them. The boundary depends on the model — long-context models swallow more whole. When the agent retrieves from an attachment rather than reading it whole, the citations point to chunk ranges in the original file.

## Where this fits

Attachments are the lightweight, chat-scoped way to bring a file into a reply. The heavyweight, org-scoped equivalent is [Documents](/platform/knowledge/documents) — same indexing pipeline, but bound to agents instead of a single chat. The page worth reading next depends on what you are trying to do — if the file matters once, attach it here; if it will matter again, upload it to Knowledge and let an agent reference it from every chat.
