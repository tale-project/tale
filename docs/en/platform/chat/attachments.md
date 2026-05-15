---
title: Chat attachments
description: Attach files to chat messages so the AI can read images, documents, and code.
---

Attach files to any chat message so the AI can analyse them alongside the question. Tale processes the upload before the message goes to the model — images and documents are extracted to text or vision tokens, audio and video are transcribed server-side, and the result is appended to the message body so the agent sees one coherent input. The page is for any role in the product: Members attach reference material, Editors curate scanned documents, Developers test integrations with sample payloads.

Attachments live with the conversation, not with the shared knowledge base. The deeper rules — exact pipeline, size limits, retention behaviour, security scanning — are below.

## How to attach

- Click the **paperclip** icon in the chat input toolbar and pick files from your device.
- Or drag and drop files directly onto the chat window.

You can attach multiple files at once. Each file shows a progress spinner while it uploads; the message is only sent once every attachment is ready.

## Supported file types

| Category      | Extensions                                               | What the AI does                                                                                           |
| ------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Images**    | `PNG`, `JPEG`, `GIF`, `WebP`                             | Looks at visual content — layout, charts, photos, text inside the image.                                   |
| **Documents** | `PDF`, `DOCX`, `XLSX`, `PPTX`, `TXT`, `Markdown`         | Reads the text content, including tables and headings.                                                     |
| **Code**      | `JS`, `TS`, `Python`, and most common source formats     | Reads the source as plain text with syntax awareness.                                                      |
| **Audio**     | `MP3`, `M4A`, `WAV`, `OGG`, `WebM` audio                 | Transcribes the audio track and hands the text to the agent. The raw bytes never reach the chat model.     |
| **Video**     | `MP4`, `MOV`, `MKV`, `WebM`, `AVI`, `MPEG`, `3GP`, `M4V` | Extracts the audio track, transcribes it, and hands the text to the agent. Visual content is **not** sent. |

### Audio and video transcription

When you attach an audio or video file, the platform runs a server-side transcription pipeline before the message is sent:

1. The file is compressed to Opus (and chunked if large) so it fits the transcription model's input limit.
2. Each chunk is sent to the organisation's configured **transcription** provider model (e.g. OpenAI Whisper or a self-hosted Whisper-compatible server such as faster-whisper-server, vLLM, or LocalAI).
3. The returned transcript is attached to the message as text.

A status pill on the attachment shows progress — _Transcribing…_, _Transcribed_, or _Could not be transcribed_. You can skip transcription per attachment, or retry a failed one. A message with pending audio cannot be sent until every attachment is either transcribed, skipped, or failed.

Admins must configure a provider model tagged `transcription` for this to work — see [AI providers](/platform/admin/providers). Transcription calls are billed per minute of audio and recorded in the usage ledger alongside chat tokens.

## Size and count limits

- **Maximum file size:** 100 MB per file by default. Admins can set a lower per-MIME-type cap (e.g. 25 MB for audio) in the [Upload policy](/platform/admin/governance#upload-policy).
- **Audio duration:** audio and video uploads are capped at 4 hours of audio. Longer files are rejected on upload — split the recording into shorter segments.
- **Maximum files per message:** 10. For bulk ingestion use the [knowledge base](/platform/workspace/knowledge-base) instead.

## Where attachments live

Files attached to chat stay with the conversation — they're not added to the shared knowledge base automatically. If you want the AI to remember a file for later conversations, upload it to the knowledge base separately.

Deleting a conversation also deletes its attachments unless your organisation's [retention policy](/platform/admin/governance) keeps them longer.

## Security

Uploads are scanned for viruses and blocked mime types before they reach the model. If the organisation's admin has enabled [PII detection](/platform/admin/governance), text extracted from attachments is run through the same rules as typed messages — flagged entities are redacted before the agent sees the input.

## Where this fits

Attachments are the one-off path: a file you want the AI to see for this conversation, then forget. For files the AI should be able to pull up across conversations, use the [knowledge base](/platform/workspace/knowledge-base) instead — it indexes the content once and every agent in the organisation can search it. The two paths use the same parsing pipeline; the difference is the lifespan and the audience.
