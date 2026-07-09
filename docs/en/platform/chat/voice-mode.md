---
title: Voice mode
description: Speaking instead of typing — how the round-trip works, which model handles speech-to-text, which handles text-to-speech, and what the privacy boundary covers.
---

Voice mode turns the composer into a microphone. You speak, Tale transcribes, the agent replies in text, and the reply is read back out loud. The whole loop is hands-free — useful when you are walking, driving (legally), cooking, or tired of typing.

The composer's speech path crosses two model providers (speech-to-text, then text-to-speech) and one or two agent calls in between. Knowing which provider holds which piece of the audio is the difference between "this is convenient" and "this is reckless" for your organisation's data.

## How voice mode runs

Tap the microphone icon on the composer and recording starts; tap again to stop. Tale uploads the audio clip, the speech-to-text model transcribes it, and the transcript becomes the next message in the chat — exactly as if you had typed it. The agent answers in text; once the reply is complete, Tale routes it to a text-to-speech model and plays the audio back. While the reply is streaming, **Stopped** ends playback early; **Play voice output** re-plays the last reply.

## STT and TTS handoffs

Two model picks matter, and they are configured separately from the chat model. **Speech-to-text** runs once per spoken message — the audio is uploaded, transcribed, and the transcript is what the agent sees. **Text-to-speech** runs once per reply — Tale chunks the reply into voice-output segments and streams audio back. The agent itself is unchanged; voice mode is a wrapper around the same composer.

## Voice picking

Each agent can pin a preferred voice in its settings; without a per-agent pick, voice mode uses the org default. Voices are tied to specific TTS providers — switching the provider switches the available voices. If a chat uses an agent whose voice provider is no longer configured, Tale falls back to the org default voice rather than failing the reply.

## Privacy boundary

The audio clip you record leaves your device. It is uploaded to Tale's storage, sent to the speech-to-text provider you configured, and the transcript is kept in the chat history alongside the typed messages. The audio itself is retained per the org's retention policy. Replies go out to the text-to-speech provider as plain text; the audio response is streamed to your device and not stored on disk by default.

<Warning>

Organisations with strict data-out-of-region rules should pick STT and TTS providers in the same region as the rest of the stack — see [Data residency](/cloud/data-residency).

</Warning>

## When voice beats text

Voice is faster than typing for short, conversational questions and dramatically slower than typing for code, lists, or anything you would copy out. Voice replies cap out at a chunk limit — long replies stop reading partway through and surface a notice. Reach for voice when the answer will be heard once and forgotten; reach for text when the answer needs to be skimmed or saved.

## When to reach for it

| Use … when                                         | Voice mode | Text |
| -------------------------------------------------- | ---------- | ---- |
| You are hands-busy and want a quick fact           | ✓          |      |
| The reply will be a long list or code block        |            | ✓    |
| The agent's reply will inform a later written task |            | ✓    |
| You are practising a language and want to hear it  | ✓          |      |

## Where this fits

Voice mode is one of three "input shape" options on the same composer: text (the default), attachments, and voice. The privacy story matters most here because two extra providers touch the data, so the page worth reading next is [Data residency](/cloud/data-residency) on Cloud or [Configuration → providers](/self-hosted/configuration/providers) on self-hosted, depending on which edition you run.
