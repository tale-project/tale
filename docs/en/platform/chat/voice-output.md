---
title: Voice output
description: Have the assistant read replies aloud as they stream, with per-thread overrides and a browser-TTS fallback.
---

Voice output reads the assistant's replies aloud as they stream. It synthesises each sentence as soon as it appears, so playback starts within a second or two of the first words landing — there is no waiting for the full reply to finish.

## Turning it on

Voice output is off by default. There are two places to control it:

- **Per-thread toggle.** A speaker icon in the chat header (top-right, next to Share). Click cycles through three states: _follow default_ (your global preference), _explicitly on_ (this thread only), and _explicitly off_ (this thread only).
- **Global default.** In **Settings → Personalization → Voice output**, switch the default on. New conversations will speak replies until you override them in the chat header.

The first time you turn voice on in a session, the click also unlocks the browser's audio system. Without that gesture, mobile Safari and stricter Chromium builds will refuse to play synthesised audio automatically, and the indicator on each message will show "Voice playback blocked — tap to play" until you tap.

## What plays

Voice output narrates assistant replies in your interface language. It strips markdown decoration (bold, italic, headings, link syntax) and skips fenced code blocks so listeners don't hear "asterisk asterisk hello asterisk asterisk" or have a Python script read aloud. Inline punctuation, numbers, and abbreviations stay intact.

## Provider vs browser fallback

Voice output prefers a server-side text-to-speech provider for quality and consistency. When your organization has not configured one — or when synthesis fails — Tale automatically falls back to the browser's built-in `speechSynthesis` for that sentence. The fallback is per-chunk, so a transient provider error or codec mismatch on one sentence does not break the rest of the reply.

When no provider is configured, the personalization page surfaces a link to **Settings → AI providers**, where an admin can add one. See [Configure a text-to-speech provider](/self-hosted/configuration/providers#openai) for the configuration shape.

## Stopping and replaying

While a message is being read, a stop button appears in its toolbar. Stopping pauses immediately; a new assistant message that arrives later still plays automatically (the toggle is persistent until you flip it off).

If you switch threads mid-playback, audio stops cleanly. Past assistant messages do **not** auto-replay when you return to a thread — you'd hear the same content twice. Use the play button on the indicator to replay any single message manually.

## What errors look like

| Indicator state              | Meaning                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Animated speaker             | Currently reading.                                                                                                                               |
| Loading spinner              | Synthesis in progress; no audio ready yet.                                                                                                       |
| Stop icon                    | Audio playable; reading in progress.                                                                                                             |
| Plain speaker                | Audio ready or finished; tap to (re)play.                                                                                                        |
| Amber speaker, "Tap to play" | Browser blocked autoplay. Tap the indicator to start playback.                                                                                   |
| Red alert icon, "…failed"    | Synthesis errored on every retry. Hover for the classified reason (no provider, rate-limited, budget reached, transient outage). Click to retry. |

Rate-limit and rate-limiter contention errors auto-retry up to two times with exponential backoff. Provider 5xx, timeout, and other errors (no provider configured, bad credentials, budget exceeded) do not auto-retry; the indicator surfaces them with a tooltip and you tap to retry. The assistant text remains readable on-screen.

## Cost and quota

Each synthesised character bills the configured provider. Tale's budget policy applies to voice output the same way it applies to chat: synthesis blocks once the per-period cost or request cap is reached. The platform also enforces per-user and per-organization rate limits on TTS so a scripted abuser cannot exhaust a provider quota.

Audio is cached in Convex storage for about seven days, so re-playing a recent message does not re-bill. After that the row and blob are removed by lazy cleanup; the next play synthesises afresh.

## Accessibility

The indicator announces its state via a screen-reader live region ("Speaking", "Stopped", "Voice output failed"). Animations respect `prefers-reduced-motion` — both the speaking pulse and the loading spinner become static when reduced motion is on. The toggle uses `aria-pressed="mixed"` for the inheriting (follow-default) state so the three positions are distinguishable to assistive tech.

If you use a screen reader, you may want to leave voice output off — both the screen reader and the assistant voice would read the same text, talking over each other.
