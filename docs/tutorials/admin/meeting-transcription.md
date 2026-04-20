---
title: Meeting transcription
description: Capture meeting audio locally with Meetily and summarise through a Tale agent.
---

Tale does not transcribe audio server-side — the dictation in chat runs entirely in the browser, and the platform has no Whisper endpoint. For a full meeting-capture workflow (record system audio, transcribe, summarise, store) you pair Tale with a local tool that handles the audio path. [Meetily](https://github.com/Zackriya-Solutions/meetily) is an MIT-licensed, 100% local meeting recorder that transcribes with Whisper.cpp on-device and sends only the transcript to an LLM for summarisation.

That split matters: raw audio never leaves the endpoint, Whisper runs on the presenter's laptop, and Tale only ever sees text. Your existing row-level security, audit logging, and governance policies cover the full sensitive path because everything that reaches Tale is already a conversation thread.

## What you will build

A meeting flow where Meetily captures and transcribes audio locally, then hands the transcript to a Tale agent that produces a structured summary — participants, decisions, action items — stored as a normal conversation thread.

## Prerequisites

- A Tale instance reachable on HTTPS, with Admin access and at least one [agent](/platform/agents/create) suitable for summarisation. The system prompt in Step 1 below is a good starting point.
- Meetily installed on the workstation that will record the meeting — see the project's [latest release](https://github.com/Zackriya-Solutions/meetily/releases). macOS and Windows are supported.
- A Tale API key (`tale_...`) from **Settings > API Keys**.

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

Pick the **Advanced** model preset — the quality lift matters more than cost on a once-per-meeting call. See [Create an agent](/platform/agents/create) and [Agent concepts](/platform/agents/concepts) for the rest of the configuration.

## Step 2 — Install Meetily

Download and install Meetily from the project's releases page; the project docs at [meetily.ai](https://meetily.ai) and the [GitHub README](https://github.com/Zackriya-Solutions/meetily) cover per-OS install steps, including the first-run permission grants for system audio. Verify you can record a short clip and see a transcript appear before moving on — that confirms Whisper is working locally.

## Step 3 — Point Meetily at Tale

In Meetily's **Settings > LLM provider** (label varies by version), choose **Custom OpenAI-compatible** and set:

| Field    | Value                                                                          |
| -------- | ------------------------------------------------------------------------------ |
| Base URL | `https://<your-tale-instance>/api/v1`                                          |
| API key  | The `tale_...` token from the prerequisites                                    |
| Model    | The agent slug of the summarisation agent from Step 1 — e.g. `meeting-summary` |

Save the settings. Meetily now uses the Tale agent for every summary it generates.

## Step 4 — Record and summarise a meeting

Click **Start recording** at the top of the next meeting. Meetily shows live transcription in a side panel — audio is transcribed on the CPU/GPU of the laptop, nothing is uploaded. When the meeting ends, click **Stop** and then **Generate summary**. The transcript is posted to Tale, the agent runs, and the summary appears alongside the transcript in Meetily.

In Tale, the request is a normal conversation thread under the summarisation agent — visible in the agent's conversation history, governed by your [approvals](/platform/workspace/approvals) and [governance](/platform/admin/governance) policies, and searchable in the workspace.

## Privacy notes

- **Audio never crosses the network.** Whisper.cpp runs locally.
- **The transcript does cross the network** — to your Tale instance, over HTTPS, under your reverse proxy and auth. It does not go to any third party.
- **Retention** follows Tale's standard rules. If your org retention policy is seven days, the summary thread expires on that schedule; see [Governance](/platform/admin/governance).
- **Access** to the summary is scoped by the agent's [Knowledge tab](/platform/agents/create#knowledge-tab) and [team](/platform/admin/teams) rules — standard agent RLS.

## Troubleshooting

- **Context-window errors on long meetings** — the transcript exceeds the model's input limit. Options: switch the agent's Model preset to one with a larger context, or pre-chunk the transcript in Meetily's summary settings. See [Agent concepts — Model](/platform/agents/concepts#model).
- **Summaries in the wrong language** — either the transcript was mixed-language, or the system prompt did not pin the output language. Tighten the prompt's "Rules" section.
- **Empty summary** — the transcript reached Tale but the agent refused. Check the conversation thread in the Tale UI for the actual model response; if the agent was gated by [governance rules](/platform/admin/governance), the reason appears there.
- **401 Unauthorized** — API key was revoked or mistyped; regenerate in **Settings > API Keys**.

## Next

- Pipe the same transcript through a workflow instead of a single agent call: [Trigger an automation via webhook](/tutorials/developer/trigger-automation-via-webhook).
- Run the summariser with a fully local model backing: [Connect a local provider](/tutorials/admin/connect-local-provider).
