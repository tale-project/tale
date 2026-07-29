---
title: Voice mode
description: Speaking instead of typing — how a recording becomes a message, how a reply gets read back, and which providers touch the audio on the way.
---

Voice mode turns the composer into a microphone. You speak, the recording is transcribed into your next message, the agent answers in text, and the answer can be read back out loud. The loop is hands-free, which is worth a lot when you are walking, cooking, or tired of typing — and it crosses two speech providers, which is worth knowing before your organisation's data goes through it.

This page covers both halves of the round-trip and the boundary the audio crosses. The chat itself does not change: voice is a wrapper around the same message flow described in [Chat basics](/platform/chat/basics).

## Speech to text

Start recording from the composer's microphone control and speak; stop it the same way. The recording is uploaded, a speech-to-text model transcribes it, and the transcript becomes the next message in the chat — exactly as if you had typed it. You can read the transcript before it goes, which matters because a transcription error is indistinguishable from a badly phrased question once the agent has answered it.

Transcription runs once per spoken message. What the agent receives is text; no audio reaches the chat model.

## Text to speech

Reading a reply aloud is a choice you make in the composer, for the turn you are about to send. Switch voice output on and the reply that comes back is sent to a text-to-speech model and played as it arrives; leave it off and the reply lands as text like any other. Playback can be stopped early, and the last reply can be played again without re-asking the question.

<Note>

Voice output is a composer control, not a saved preference. There is no per-agent voice pinned to an agent and no organisation-wide default that decides for you — the turn you are sending is the scope of the choice, which keeps a hands-free session from following you into a shared office.

</Note>

## Which provider holds which piece

Two model picks matter here, and neither is the model in the model picker. Speech-to-text runs before the agent turn, on the audio. Text-to-speech runs after it, on the finished reply. The agent between them is unchanged — the same instructions, the same tools, the same context contract.

Both are configured by whoever administers the organisation's providers. If no speech provider is configured, the composer's voice controls have nothing to call, and the answer is to connect one rather than to change anything in the chat.

## Privacy boundary

The recording leaves your device. It is uploaded to Tale's storage, sent to the speech-to-text provider the organisation configured, and the resulting transcript is kept in the chat history alongside the typed messages — searchable, exportable, and subject to the same retention rules as everything else in the chat. The audio itself is retained under the org's retention policy.

Replies go out to the text-to-speech provider as plain text, and the returned audio streams to your device rather than being stored.

<Warning>

Organisations with strict data-residency rules should pick speech providers in the same region as the rest of the stack — the audio and the transcript are subject to the same rules as any other message content. See [Data residency](/cloud/data-residency).

</Warning>

## When voice beats text

Voice is faster than typing for short, conversational questions and considerably slower for anything you would copy out afterwards. A spoken answer is heard once; a written one can be skimmed, quoted, and pasted.

| Use … when                                        | Voice | Text |
| ------------------------------------------------- | ----- | ---- |
| You are hands-busy and want a quick fact          | ✓     |      |
| The reply will be a long list or a code block     |       | ✓    |
| The agent's reply will feed a later written task  |       | ✓    |
| You are practising a language and want to hear it | ✓     |      |

## Where this fits

Voice is one of three input shapes on the same composer: typing, [attachments](/platform/chat/attachments), and speech. The privacy story carries the most weight here because two extra providers touch the data, so the page worth reading next depends on your edition — [Data residency](/cloud/data-residency) on Cloud, or [Providers](/self-hosted/configuration/providers) if you run Tale yourself and choose the speech providers as well as the chat ones.
