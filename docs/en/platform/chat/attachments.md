---
title: Chat attachments
description: Attach files to chat messages so the AI can read images, parse documents, and transcribe audio or video before answering.
---

Chat attachments are files you send alongside a message so the AI can analyse them in the same turn. Tale processes every upload before the message reaches the model — images and documents are extracted to vision tokens or plain text, audio and video are transcribed server-side, and the result is appended to the message body so the agent sees one coherent input. The page is for any role in the product: Members attach reference material to a question, Editors curate scanned documents, Developers test integrations with sample payloads.

Attachments live with the conversation, not with the shared knowledge base. The pipeline below covers what gets sent where, the size and count limits, the retention rules, and the security scan path.

## Attach a file

To attach a file, click the **paperclip** icon in the composer toolbar and pick files from your device, or drag and drop files directly onto the chat window. The message only sends once every attachment is ready — each file shows a progress spinner while it uploads, plus a transcription status pill for audio and video.

## Supported file types

The accepted formats group into five categories, each with its own processing path before the message reaches the model:

| Category      | Extensions                                               | What happens before the model sees it                                                               |
| ------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Images**    | `PNG`, `JPEG`, `GIF`, `WebP`                             | Sent as vision tokens — the model looks at layout, charts, photos, and text inside the image.       |
| **Documents** | `PDF`, `DOCX`, `XLSX`, `PPTX`, `TXT`, `Markdown`         | Text and table content is extracted; the model reads the extracted text, not the binary file.       |
| **Code**      | `JS`, `TS`, `Python`, and most common source formats     | Read as plain text with syntax awareness.                                                           |
| **Audio**     | `MP3`, `M4A`, `WAV`, `OGG`, `WebM` audio                 | Transcribed server-side; only the transcript reaches the chat model.                                |
| **Video**     | `MP4`, `MOV`, `MKV`, `WebM`, `AVI`, `MPEG`, `3GP`, `M4V` | The audio track is extracted, transcribed, and passed to the agent. Visual content is **not** sent. |

## Audio and video transcription

Audio and video uploads run through a server-side transcription pipeline before the chat model sees anything. The pipeline compresses the file to Opus and chunks it if it's too large for the transcription model's input limit, sends each chunk to the organisation's configured `transcription` provider model (OpenAI Whisper or a self-hosted Whisper-compatible server like faster-whisper-server, vLLM, or LocalAI), and attaches the returned transcript as text to the message.

A status pill on the attachment tracks progress — _Transcribing…_, _Transcribed_, or _Could not be transcribed_. You can skip transcription per attachment or retry a failed one. A message with a pending audio attachment cannot be sent until every attachment is transcribed, skipped, or marked failed.

Transcription requires a provider model tagged `transcription` — Admins configure this once under [AI providers](/platform/admin/providers). Transcription calls are billed per minute of audio and recorded in the usage ledger alongside chat tokens.

## Size and count limits

The default caps on attachments per message:

- **Per-file size:** 100 MB by default. Admins can set a lower per-MIME-type cap (for example, 25 MB for audio) in the [Upload policy](/platform/admin/governance#upload-policy).
- **Audio duration:** audio and video uploads are capped at 4 hours of audio. Longer files are rejected on upload — split the recording into shorter segments.
- **Files per message:** 10. For bulk ingestion, the [knowledge base](/platform/workspace/knowledge-base) is the right surface — it indexes the content once and every agent in the organisation can search it.

## What happens to the file afterwards

Files attached to chat stay with the conversation — they're not added to the shared knowledge base automatically. Deleting a conversation also deletes its attachments unless your organisation's [retention policy](/platform/admin/governance) keeps them longer.

## Security and PII

Every upload is scanned for viruses and blocked MIME types before it reaches the model. If your organisation has [PII detection](/platform/admin/governance) enabled, text extracted from attachments is run through the same rules as typed messages — flagged entities are redacted before the agent sees the input.

## Where this fits

Attachments are the one-off path: a file you want the AI to see for this conversation, then forget. For files the AI should be able to pull up across conversations, the [knowledge base](/platform/workspace/knowledge-base) indexes the content once and every agent in the organisation can search it. The two paths use the same parsing pipeline; the difference is the lifespan and the audience.
