---
title: Chat attachments
description: Attach files to chat messages so the AI can read images, documents, and code.
---

You can attach files to any chat message so the AI agent can analyse them alongside your question. Attachments are processed before the message is sent and their content is included in the conversation.

## How to attach

- Click the **paperclip** icon in the chat input toolbar and pick files from your device.
- Or drag and drop files directly onto the chat window.

You can attach multiple files at once. Each file shows a progress spinner while it uploads; the message is only sent once every attachment is ready.

## Supported file types

| Category      | Extensions                                     | What the AI does                                                         |
| ------------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| **Images**    | PNG, JPEG, GIF, WebP                           | Looks at visual content — layout, charts, photos, text inside the image. |
| **Documents** | PDF, DOCX, XLSX, PPTX, TXT, Markdown           | Reads the text content, including tables and headings.                   |
| **Code**      | JS, TS, Python, and most common source formats | Reads the source as plain text with syntax awareness.                    |

## Size and count limits

- **Maximum file size:** 100 MB per file.
- **Maximum files per message:** 10. For bulk ingestion use the [knowledge base](/use/workspace/knowledge-base) instead.

## Where attachments live

Files attached to chat stay with the conversation — they're not added to the shared knowledge base automatically. If you want the AI to remember a file for later conversations, upload it to the knowledge base separately.

Deleting a conversation also deletes its attachments unless your organisation's [retention policy](/admin/governance) keeps them longer.

## Security

Uploads are scanned for viruses and blocked mime-types before they reach the model. If your admin has enabled [PII detection](/admin/governance), text extracted from attachments is run through the same rules as typed messages.
