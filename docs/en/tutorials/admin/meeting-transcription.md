---
title: Meeting transcription
description: Capture meeting audio locally with Meetily and summarise through a Tale agent.
---

Tale supports audio transcription two ways, and this tutorial walks through the **fully local** option. If you only need to summarise ad-hoc recordings, dropping an audio or video file into chat is the simplest path — the platform's transcription pipeline handles it server-side (see [Chat attachments](/platform/chat/attachments#audio-and-video-transcription)). But for a full meeting-capture workflow where the raw audio never leaves the presenter's laptop, you pair Tale with a local tool that handles the audio path. [Meetily](https://github.com/Zackriya-Solutions/meetily) is an MIT-licensed, 100% local meeting recorder that transcribes with Whisper.cpp on-device and sends only the transcript to an LLM for summarisation.

That split matters: raw audio never leaves the endpoint, Whisper runs on the presenter's laptop, and Tale only ever sees text. Your existing row-level security, audit logging, and governance policies cover the full sensitive path because everything that reaches Tale is a real agent conversation thread.

Pick the server-side flow when convenience matters and you trust your configured transcription provider with the audio; pick this Meetily flow when compliance or network policy requires that audio bytes never cross the endpoint boundary.

## What you will build

A meeting flow where Meetily captures and transcribes audio locally, then hands the transcript to a Tale agent that produces a structured summary — participants, decisions, action items — stored as a normal conversation thread under that agent.

## Prerequisites

- A Tale instance reachable on HTTPS, with Admin access and at least one [agent](/platform/agents/create) suitable for summarisation. The system prompt in Step 1 below is a good starting point.
- Meetily installed on the workstation that will record the meeting — see the project's [latest release](https://github.com/Zackriya-Solutions/meetily/releases). macOS and Windows are supported.

## Step 1 — Configure a summarisation agent

Create a dedicated agent so summaries use the model, tone, and format you want. A starting system prompt:

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

Pick a capable model — quality matters more than cost on a once-per-meeting call. See [Create an agent](/platform/agents/create) for the rest of the configuration.

## Step 2 — Create a webhook for the agent

Open the agent's **Webhook** tab and click **Create**. Tale generates a URL of the form `https://<your-tale-instance>/api/agents/wh/<TOKEN>`. Copy it — you'll paste it into Meetily in Step 4.

Treat the webhook URL like an API key: anyone holding it can invoke this specific agent. Disable or delete the webhook to revoke access.

## Step 3 — Install Meetily

Download and install Meetily from the project's releases page; the project docs at [meetily.ai](https://meetily.ai) and the [GitHub README](https://github.com/Zackriya-Solutions/meetily) cover per-OS install steps, including the first-run permission grants for system audio. Verify you can record a short clip and see a transcript appear before moving on — that confirms Whisper is working locally.

## Step 4 — Point Meetily at the Tale webhook

In Meetily's `Settings > LLM provider` (label varies by version), choose **Custom OpenAI-compatible** and set:

| Field    | Value                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Base URL | The webhook URL from Step 2 (e.g. `https://<tale>/api/agents/wh/<TOKEN>`)                                                    |
| API key  | Any non-empty value — the URL token is the credential                                                                        |
| Model    | A model ID from the agent's `supportedModels` (e.g. `openai/gpt-4o`). Unrecognised values silently fall back to the default. |

Save the settings. Meetily will append `/chat/completions` to the Base URL automatically; every summary it generates now flows through the configured Tale agent.

## Step 5 — Record and summarise a meeting

Click **Start recording** at the top of the next meeting. Meetily shows live transcription in a side panel — audio is transcribed on the CPU/GPU of the laptop, nothing is uploaded. When the meeting ends, click **Stop** and then **Generate summary**. The transcript is posted to Tale, the agent runs, and the summary appears alongside the transcript in Meetily.

In Tale, the request becomes a real conversation thread under the summarisation agent — visible in the agent's conversation history, counted against the org's usage ledger, tagged in the audit log, and governed by the agent's team and knowledge rules.

## Privacy notes

- **Audio never crosses the network.** Whisper.cpp runs locally.
- **The transcript does cross the network** — to your Tale instance, over HTTPS, under your reverse proxy and auth. It does not go to any third party.
- **Retention** follows Tale's standard rules. If your org retention policy is seven days, the summary thread expires on that schedule; see [Governance](/platform/admin/governance).
- **Access** to the summary is scoped by the agent's [Knowledge tab](/platform/agents/create#knowledge-tab) and [team](/platform/admin/teams) rules — standard agent RLS.
- **Client system prompt.** Any `system` message Meetily sends is concatenated after the agent's own system prompt — agent rules frame identity and output format; Meetily's prompt adds use-case detail.

## Troubleshooting

- **Context-window errors on long meetings** — the transcript exceeds the model's input limit. Switch the agent to a model with a larger context, or pre-chunk the transcript in Meetily's summary settings. See [Agent concepts — Model](/platform/agents/concepts#model).
- **Meetily timed out** — Meetily's client-side timeout is 300 seconds. On slow providers a long transcript can exceed it. Options: switch to a faster model, shorten the transcript, or retry after generation completes (the thread in Tale will still hold the full summary).
- **Summaries in the wrong language** — either the transcript was mixed-language, or the system prompt did not pin the output language. Tighten the prompt's "Rules" section.
- **Empty or refused summary** — inspect the agent's conversation thread in Tale; the full model response (including any refusal or governance message) appears there.
- **401 Unauthorized** — the webhook URL is invalid or the webhook is disabled. Check Settings > agent > **Webhook** tab; toggle active, or delete and regenerate.

## Where this fits

What you built is a privacy-preserving meeting capture: raw audio stays on the laptop, only the transcript crosses the network, and Tale handles the summary as a normal agent conversation — auditable, retention-bound, knowledge-scoped. The trade-off versus the server-side transcription path is one of trust boundary: Meetily moves the audio handling under your endpoint policy at the cost of an extra desktop dependency. If your compliance posture allows server-side transcription, the simpler path is to drop the recording into chat directly.

Two directions to take the same flow further: pipe transcripts through an automation instead of a single agent call with [Trigger an automation via webhook](/tutorials/developer/trigger-automation-via-webhook), or push the model itself on-device with [Connect a local provider](/tutorials/admin/connect-local-provider) so the summary never leaves the network either.
