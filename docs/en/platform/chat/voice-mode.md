---
title: Voice mode
description: Dictate a message, check the transcript before sending, and listen to replies when voice output is available.
---

Dictation lets you speak a message instead of typing it. Voice output reads an assistant reply aloud. You can use either on its own: dictating does not require spoken replies, and listening does not require microphone access.

## Dictate and check a message

1. Click **Start dictation** on the composer's microphone control.
2. Allow microphone access in the browser if asked, then speak clearly.
3. Click **Stop dictation**. Where server transcription is used, wait for it to finish.
4. Read and correct the text in the message field, especially names, numbers, and dates. Send when it is ready.

Dictation adds text to the composer; it does not automatically send the message. Sending stops an active dictation. The chat model receives the text you submit.

Tale first uses the browser's speech-recognition capability when available. Otherwise, it can record and transcribe through your organization's configured transcription model. If neither route is available, the microphone is absent or explains the missing configuration. Browser speech recognition may use a browser-vendor service; do not assume dictation works offline.

## Listen to a reply

Enable **Voice mode** in the composer to hear replies in the current chat. A text-to-speech model prepares audio from the answer. Use the reply's playback control to stop or play it again; the written response remains available for checking details.

An organization policy can hide voice output. A disabled control can also mean there is no usable speech model. An administrator checks the configured [AI providers](/platform/admin/providers); changing the chat model alone does not supply a speech provider.

The voice setting on an existing chat applies to that chat. Setting it on a new chat also establishes the default for later chats. There is no separate voice configuration on each project agent.

## Recover a voice problem

| Symptom | What to check |
| --- | --- |
| The microphone will not start | Browser microphone permission, the selected input device, and whether another app is using it. |
| Words are missing or wrong | Reduce background noise and correct the transcript before sending. |
| Server transcription failed | Use the retry control while the failed recording remains available, or discard it and type. |
| A reply is ready but silent | Check device volume and browser playback permission, then use the reply's play control. |
| Voice reports a configuration error | Ask an administrator to check the speech model and credential. |

A failed server-transcription recording is held in the current page's memory for retry. Leaving or reloading the page can lose that recording. It is not a saved audio attachment; use [attachments](/platform/chat/attachments) when you want to upload an existing recording.

## Understand the audio path

Browser dictation follows the browser's speech service. The server fallback sends the recording to Tale for transcription with the organization's configured provider; this dictation path does not store it as a document. Once sent, the transcript becomes part of chat history.

Voice output sends answer text to the configured speech provider and streams audio for playback. If the answer contains information from a restricted source, that text is included in the speech request. Administrators should choose speech services consistent with the organization's [data-residency requirements](/cloud/data-residency).
