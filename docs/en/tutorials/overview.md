---
title: Tutorials
description: Task-oriented, end-to-end walkthroughs for every Tale role.
---

Tutorials are step-by-step walkthroughs that take you from "I want to do X" to a working result. They sit alongside the [Platform](/platform) reference: reference describes what every feature does in isolation, tutorials show how to combine features into a concrete outcome. Open Platform when you already know the feature and need detail; open this section when you want a guided path.

The tutorials are grouped by role so you land on content you can actually execute. Permissions follow the [six-role model](/platform/admin/members-and-roles) — if a tutorial sits under Admin, you need an Admin or Owner seat to finish it.

## By role

- **Member** — [Chat effectively](/tutorials/member/chat-effectively): combine agents, attachments, and dictation into a daily workflow.
- **Editor** — [Build your first agent end to end](/tutorials/editor/first-agent-end-to-end): create an agent, attach knowledge, test, and publish a version.
- **Developer** — [Call Tale from a script](/tutorials/developer/call-tale-from-a-script) and [Trigger an automation via webhook](/tutorials/developer/trigger-automation-via-webhook).
- **Admin** — [Word & Excel add-in](/tutorials/admin/office-add-in), [Meeting transcription](/tutorials/admin/meeting-transcription), and [Connect a local provider](/tutorials/admin/connect-local-provider).

## Prerequisites that apply to every tutorial

- A Tale instance you can reach — Cloud or [self-hosted](/self-hosted).
- An account in that instance. Role-gated tutorials say so at the top.
- For tutorials that call the API, an API key from **Settings > API Keys**. Creation is Admin-only; see [Members and roles](/platform/admin/members-and-roles).

If a step assumes something not listed above, the tutorial spells it out in its own prerequisites section.

## Working through a tutorial

Tutorials are written to run in order, top to bottom, on a fresh instance. If you skip a section assuming you already have the prerequisite, double-check — the next step often depends on the exact field the skipped section configures. When something fails, the [Execution logs](/platform/automations/execution-logs) page (for automations) and the conversation history (for agents) usually carry enough context to diagnose without going back to the tutorial.

## Where this fits

Tutorials are the worked-example layer of the documentation. They take a real outcome — an Office add-in, an agent that summarises meetings, a script that hits the API — and walk every step needed to reach it. For the conceptual mental model behind each tutorial, the corresponding page under [Platform](/platform) is the reference; for the broader API and SDK surfaces the developer tutorials build on, [Develop](/develop/api-reference) is one tab over.
