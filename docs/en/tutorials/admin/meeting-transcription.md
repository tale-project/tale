---
title: Meeting transcription
description: Capture meeting audio locally with Meetily and summarise through a Tale agent.
---

Tale supports audio transcription two ways, and this integration tutorial walks the **fully local** option. If you only need to summarise ad-hoc recordings, dropping an audio or video file into chat is the simplest path — the platform's transcription pipeline handles it server-side, documented at [Chat attachments](/platform/chat/attachments#audio-and-video-transcription). For a full meeting-capture workflow where the raw audio never leaves the presenter's laptop, pair Tale with [Meetily](https://github.com/Zackriya-Solutions/meetily) — an MIT-licensed, fully local meeting recorder that transcribes with Whisper.cpp on-device and sends only the transcript to an LLM for summarisation.

The outcome at the end is a meeting flow where audio bytes never cross the endpoint boundary, but the resulting summary lands as a normal Tale conversation thread with full audit and retention coverage.

## Before you begin

You need Admin or Owner access in Tale, plus a Tale instance reachable on HTTPS from the laptop that will record. You also need at least one [agent](/platform/agents/create) tuned for summarisation; the system prompt in Step 1 is a starting point you can paste in. On the recording laptop you need Meetily installed — see the project's [latest release](https://github.com/Zackriya-Solutions/meetily/releases), which ships builds for macOS and Windows.

No Tale-side feature flag, no per-user permission beyond Admin.

## Step 1 — Configure a summarisation agent

A dedicated agent gives summaries the model, tone, and structure you want, and keeps the meeting threads from cluttering the general chat agent's history. Open **Agents > Create agent** and paste the prompt below as the system instructions:

```text
You are the meeting-summary agent.

Input: a raw transcript of a meeting, possibly with imperfect speaker labels.
Output, in Markdown:
1. A one-paragraph summary.
2. Decisions — bullet list, each with the person responsible.
3. Action items — bullet list in the format "Owner — task — due date (if mentioned)".
4. Open questions — bullet list of things that were raised but not resolved.

Rules:
- Do not invent content. If something is unclear, say so.
- Preserve the language of the transcript.
- Never include raw quotes longer than one sentence.
```

Pick a capable model — quality matters more than cost on a once-per-meeting call. The rest of the agent's configuration follows [Create an agent](/platform/agents/create).

The step worked when the agent's chat preview produces the four-section structure on a short test transcript pasted into the composer.

## Step 2 — Create a webhook for the agent

Open the agent's **Webhook** tab and click **Create**. Tale generates a URL of the form `https://<your-tale-instance>/api/agents/wh/<TOKEN>` — the token is 64 hex characters and is the only credential. Anyone holding the URL can invoke this agent; treat it the way you'd treat an API key, and disable or delete the webhook to revoke access.

Meetily speaks OpenAI-compatible chat completions, so use the `/chat/completions` sub-path when configuring it in Step 4:

```text
https://<your-tale-instance>/api/agents/wh/<TOKEN>/chat/completions
```

The step worked when the Webhook tab shows the URL with a copy button and an "Active" toggle on.

## Step 3 — Install Meetily

Download and install Meetily from the project's releases page. The project docs at [meetily.ai](https://meetily.ai) and the [GitHub README](https://github.com/Zackriya-Solutions/meetily) cover per-OS install, including the first-run permission grants for system audio. Record a short test clip — fifteen seconds of you reading any paragraph — and confirm the live transcript appears in the side panel.

The step worked when the test transcript matches what you said, confirming Whisper runs locally on the laptop.

## Step 4 — Point Meetily at the Tale webhook

In Meetily's settings, open the LLM provider panel (the exact label varies by release — recent builds use **Settings > Models** or **Settings > LLM provider**). Choose the **Custom OpenAI-compatible** option and configure:

| Field    | Value                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------- |
| Base URL | The `/chat/completions` URL from Step 2 — e.g. `https://<your-tale-instance>/api/agents/wh/<TOKEN>/chat/completions` |
| API key  | Any non-empty value — the URL token is the credential                                                                |
| Model    | A model ID from the agent's `supportedModels` (e.g. `openai/gpt-4o`); unrecognised values fall back to the default   |

Save. Meetily now sends summaries through the configured Tale agent.

The step worked when Meetily's settings UI shows the saved provider and "Test" (if present) returns a 200 response.

## Step 5 — Record and summarise a meeting

Click **Start recording** at the top of the next meeting. Meetily transcribes locally — the CPU or GPU on the laptop does the work, and nothing is uploaded during the meeting. When the meeting ends, stop the recording and click **Generate summary**. The transcript is POSTed to Tale, the agent runs, and the structured summary appears in Meetily alongside the transcript.

In Tale, the request becomes a real conversation thread under the summarisation agent — visible in the agent's history, counted against the org's usage ledger, tagged in the audit log, and governed by the agent's team and knowledge rules.

The step worked when both Meetily shows the summary and the agent's conversation history shows a new thread with the same content.

## Trust boundary

What crosses the network in each direction:

- **Audio**: never leaves the recording laptop. Whisper.cpp runs locally; there's no upload of the raw recording at any point in the flow.
- **Transcript**: crosses the network from the laptop to your Tale instance over HTTPS, under your reverse proxy and existing auth. It doesn't go to any third party — Meetily speaks to Tale directly.
- **Tale's outbound model call**: from Tale to whichever provider serves the agent's model. To keep this hop in-network too, pair this tutorial with [Connect a local provider](/tutorials/admin/connect-local-provider) — the summary LLM then also stays local.
- **Client system prompt**: any `system` message Meetily sends is concatenated after the agent's own system prompt. The agent's prompt frames identity and output format; Meetily's prompt adds use-case detail.

Retention follows Tale's standard rules — the summary thread expires on whatever your org retention policy sets, and access is scoped by the agent's [Knowledge tab](/platform/agents/create#knowledge-tab) and [team rules](/platform/admin/teams).

## Troubleshooting

- **Context-window errors on long meetings** — the transcript exceeds the model's input limit. Switch the agent to a model with a larger context, or pre-chunk the transcript in Meetily's summary settings. See [Agent concepts — Model](/platform/agents/concepts#model).
- **Meetily timed out** — Meetily's client-side timeout is 300 seconds, and a long transcript on a slow provider can exceed it. Switch to a faster model, shorten the transcript, or retry; the thread in Tale still holds the full summary even if Meetily gave up waiting.
- **Summaries land in the wrong language** — the transcript was mixed-language, or the prompt didn't pin output language. Tighten the "Rules" section of the agent's instructions.
- **401 Unauthorized** — the webhook token is invalid or the webhook is disabled. Re-check the agent's **Webhook** tab, toggle Active, or regenerate.

## Where this fits

What you built is a privacy-preserving meeting capture: raw audio stays on the laptop, only the transcript crosses the network, and Tale handles the summary as a normal agent conversation — auditable, retention-bound, knowledge-scoped. The trade-off versus the server-side transcription path is one of trust boundary: Meetily moves the audio handling under your endpoint policy at the cost of an extra desktop dependency.

Two directions from here: pipe transcripts through an automation instead of a single agent call with [Trigger an automation via webhook](/tutorials/developer/trigger-automation-via-webhook), or close the loop on the model side with [Connect a local provider](/tutorials/admin/connect-local-provider) so the summary LLM also stays in-network.
