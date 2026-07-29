---
title: Pipe meeting transcripts into the Knowledge Base
description: Wire Meetily (or a similar local meeting-transcription tool) into a Tale project's Knowledge Base so transcripts land as documents on their own without anyone uploading a file.
---

A meeting transcript is one of the highest-value documents a project can keep — names, decisions, follow-ups, all in one searchable place. This walk integrates Meetily, a local meeting-transcription tool, with a Tale project so every transcript Meetily produces lands in the project's Knowledge Base as a document on its own. The walk is for an Admin on a self-hosted Tale instance pairing it with a Meetily install on the same network.

You need an Admin role in Tale, a Meetily install reachable from the `tale-platform` container, and one project in Tale with a Knowledge Base you want the transcripts routed into. The Knowledge Base concept lives in [Knowledge Base](/platform/knowledge/overview); this page is the connector walk, not the concept page.

## Before you begin

Confirm four things. Your role is Admin or Owner in Tale — the **Connectors** panel is hidden below that. Meetily is running and producing transcripts in a format Tale accepts (Markdown, plain text, or VTT). The Meetily host is reachable from `tale-platform` on its webhook or shared-folder path. And the target project already exists in Tale with a Knowledge Base attached — the connector writes _into_ a Knowledge Base, it does not create one.

## Step 1 — Pick a delivery path

Meetily can hand transcripts to Tale in two shapes, and they have different operational properties. The pick locks in how the rest of the walk reads.

The **webhook** path has Meetily POST each finished transcript to a Tale ingestion endpoint as soon as the meeting ends; the transcript is in the Knowledge Base within seconds of the meeting closing. The **shared folder** path has Meetily write transcripts as files into a directory the Tale platform polls every minute; latency is up to a minute but the path needs no public URL and survives Meetily restarts without retry logic.

Pick webhook when both services run in the same network and you want fast indexing; pick shared folder when Meetily runs on a workstation that wakes irregularly or when the operations team prefers a file-based audit trail.

## Step 2 — Create the ingestion endpoint or folder in Tale

Tale needs to know where transcripts will land and which project they belong to. Without this binding, transcripts arrive but no Knowledge Base claims them.

Open **Settings > Connectors**, click **Add connector**, and pick **Meeting transcripts**. Pick the project from the dropdown — the Knowledge Base the project uses is the destination. Pick the delivery path you chose in Step 1.

If you picked webhook, Tale generates a URL of the shape `https://<your-host>/connectors/transcripts/<token>` and shows it once. Copy the URL; it doubles as the bearer credential, so treat it like a secret.

If you picked shared folder, Tale prompts for the path on disk that `tale-platform` should watch (typically `/data/transcripts/<project-slug>`). Create the directory on the host, give it group ownership matching the `tale-platform` container user, and confirm.

## Step 3 — Point Meetily at Tale

Meetily now needs to know where to deliver each transcript. The settings live in Meetily's own config.

For the webhook path, open Meetily's settings and add a webhook destination with the URL from Step 2. Pick the transcript format — Markdown is what reads best inside a Tale document preview, but VTT and plain text both index correctly.

For the shared-folder path, set Meetily's transcript-output directory to the path you created in Step 2. Make sure Meetily writes one file per meeting, named with the meeting title and timestamp.

End a short test meeting in Meetily and watch the Tale Connectors panel. The connector row shows a **Last delivery** timestamp that updates within a minute (folder mode) or a few seconds (webhook mode).

## Step 4 — Verify the document lands and indexes

The proof the wiring works is one transcript visible in the Knowledge Base as a searchable document. Without this step you do not know whether Tale received the file _and_ indexed it.

Open the target project, navigate to its Knowledge Base, and look for the new transcript at the top of the document list. Click into the preview — the transcript renders as a document with the meeting title as the document name and the meeting date as the document's created-at. Wait for the indexing badge to clear (a few seconds for a short transcript, up to a minute for a long one), then run a search for a name or a phrase you remember from the test meeting. The transcript should be the first result with the phrase highlighted.

If the document is there but the indexing badge stays orange, indexing is behind — the [Troubleshooting](/self-hosted/operate/observability/troubleshooting) page names the symptoms.

## Privacy notes

The connector crosses one network in each direction and the data shape matters.

- **Meetily → Tale.** The transcript body crosses, plus the meeting title, the timestamp, and any speaker labels Meetily attached. Audio does not cross — Meetily transcribes locally and only the text is delivered. The webhook path uses HTTPS with the bearer token in the URL; the folder path uses a filesystem path with no network at all.
- **Tale → Meetily.** Nothing. The connector is one-way; Tale never calls back into Meetily.
- **Tale → external services.** The transcript text crosses to whichever embedding provider is bound to the Knowledge Base. If the embedding provider is a local one (Ollama, LM Studio, vLLM via [Connect a local LLM provider](/tutorials/admin/connect-local-provider)), no transcript text leaves the host. If the embedding provider is OpenAI, Anthropic, or another hosted endpoint, the transcript text is sent to that endpoint for vectorisation per the provider's data-handling policy.

When transcripts contain content the org cannot send to a cloud provider, the supported pattern is to bind the project's Knowledge Base to a local embedding model. The provider-bind happens in the Knowledge Base settings, not in this connector.

## Where this fits

The meeting-transcription connector is the cleanest example of "Tale indexes what your other tools already produce" — no copy-paste, no manual upload, no extra step in the meeting workflow. The natural next reads are [Knowledge Base](/platform/knowledge/overview) for what the indexed transcript can then be used for inside an agent, and [Connect a local LLM provider](/tutorials/admin/connect-local-provider) when the privacy section above pushes you toward keeping the embedding step on-host.
