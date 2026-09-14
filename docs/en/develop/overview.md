---
title: Build with Tale
description: Connect another system to Tale, automate a workflow, or contribute to the application source.
---

Use these guides when writing a client, connecting an external system, or changing Tale itself. Start with the smallest working request, then add the authentication, scope, and recovery handling your integration needs.

## Choose a development task

| What you want to build | Start here |
| --- | --- |
| A script that sends a message and reads the reply | [Call Tale from a script](/tutorials/developer/call-tale-from-a-script) |
| A client for projects, tasks, files, or other resources | [API reference](/develop/api-reference) |
| A connection from an MCP client | [MCP endpoint](/develop/mcp-endpoint) |
| An automation triggered by another system | [Webhooks](/develop/webhooks) |
| A filesystem client for documents | [WebDAV API](/develop/webdav-api) |
| A new connector | [Connector development](/develop/connectors) |
| A change to Tale's application code | [Contributor setup](/develop/contributor-setup) |

## Make the first request reliable

Create a separate API key for each integration, send it only to the intended instance, and keep it out of source control. [Make your first API request](/get-started/developers) explains instance URLs and organization scope. For a long-running operation, distinguish the accepted request from its eventual result: poll the resource or run and handle a failed outcome.

Read the [rate limits](/develop/rate-limits) before adding retries. Check [instance availability](/develop/status-page) when troubleshooting a connection. The API reference describes the error envelope and the generated specification for the current checkout.

## Build inside the platform

For agents, projects, and the automation editor, use the [Developer guide](/platform/developer/overview). [AI-assisted development](/develop/ai-assisted-development) explains how to combine authoring tools with validation and review.

<Video src="/videos/en/tutorials/ep10-developers/ep10-developers.en.mp4" poster="/videos/en/tutorials/ep10-developers/ep10-developers.en.webp" captions="/videos/en/tutorials/ep10-developers/ep10-developers.en.vtt" lang="en" title="Bonus — Tale for developers" caption="Bonus — Tale for developers (2:08)">

</Video>
