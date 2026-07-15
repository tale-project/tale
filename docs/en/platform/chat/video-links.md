---
title: Video links
description: Paste a video URL into the chat and Tale ingests its transcript for the agent — supported platforms, the ingestion flow, and what each failure state means.
---

Paste a video link into the composer and Tale fetches the video's transcript so the agent can read, quote, and answer from it — no manual download, no copy-paste of a transcript. It is the fastest way to bring a talk, tutorial, or recorded meeting into a reply.

This page covers the chat composer's video-link chip. For pasting files rather than links, see [Attachments](/platform/chat/attachments).

## A worked example

Paste a YouTube URL into the composer. Tale recognises it as a video link and drops a chip below the message with the video's title and a spinner. Behind the chip, Tale fetches the captions (or, when there are none, the audio, which it transcribes), indexes the transcript, and flips the chip to **Ready**. **Send** the message and the agent answers from the transcript, citing the passages it used. A long video keeps indexing in the background; the chip shows its progress and the transcript becomes searchable the moment it finishes.

## Supported platforms

Tale ingests links from **YouTube** (including `youtu.be`, `m.youtube.com`, and Music), **Vimeo**, **Dailymotion**, **Twitch**, and **Bilibili**. A link to any other host is left as ordinary text in your message — no chip appears. Only public videos work; anything behind a login, a paywall, or a region block cannot be fetched.

## What Tale extracts

Tale prefers the platform's own captions when they exist — they are exact and cheap to fetch. When a video has no captions, Tale downloads the audio and transcribes it with speech-to-text, so a caption-less upload still becomes a searchable transcript. Either way the result is indexed like any other knowledge: the agent retrieves the relevant passages at reply time and the citations point back to the transcript.

## Failure states

The chip turns red when ingestion cannot complete, with a short reason:

<AccordionGroup>

<Accordion title="The platform blocked automated access">

Video platforms — YouTube most aggressively — challenge requests that come from a server rather than a personal device, showing a "confirm you're not a bot" wall. When that happens to Tale's fetch, the chip reports that the platform prevented access. Retry in a minute (the block is often transient), or try the same video on a different platform. Self-hosted operators can reduce these blocks — see [below](#for-self-hosted-operators).

</Accordion>

<Accordion title="Too many requests">

The platform is rate-limiting Tale's fetches. Wait a moment and use the chip's **Retry**; back-to-back ingests from the same deployment are the usual cause.

</Accordion>

<Accordion title="Video unavailable">

The video is private, deleted, age- or region-restricted, or the URL is malformed. Tale can only ingest a public video; there is no workaround for a gated one.

</Accordion>

</AccordionGroup>

Every failed chip carries a **Retry**, and a retry is safe — Tale never double-indexes a video that already succeeded.

## For self-hosted operators

A managed **Cloud** deployment handles the anti-bot measures for you. If you self-host and video ingestion keeps hitting the bot wall, the deployment ships a proof-of-origin token provider that is wired up by default, and you can add an egress proxy or a pre-warmed session pool as escalation. The configuration lives in [Video ingestion](/self-hosted/configuration/video-ingestion).

## Where this fits

Video links are a chat-scoped way to ground a reply in a recording, the same way [Attachments](/platform/chat/attachments) ground it in a file. Both feed the agent's retrieval; neither persists beyond the chat. To make a video's transcript reusable across chats, copy the ingested text into a [Knowledge](/platform/knowledge/documents) document.
