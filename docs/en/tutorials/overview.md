---
title: Tutorials
description: Task-oriented, end-to-end walkthroughs for every Tale role.
---

The Tutorials section is the worked-example layer of Tale's documentation. Each page takes a single outcome — an agent that answers product-support questions, a script that calls Tale from a CI job, an Office add-in that routes through your instance — and walks every step needed to reach it on a fresh instance. They sit alongside the [Platform](/platform) reference: reference describes what every feature does in isolation, tutorials show how to combine features into a concrete result.

Tutorials are grouped by the role that owns the task, so you land on content you can actually execute with the permissions you have. Permissions follow the [six-role model](/platform/admin/members-and-roles) — if a tutorial sits under Admin, you need an Admin or Owner seat to finish it.

## How a tutorial is shaped

Every tutorial follows the same shape: a short opening that names the outcome and the prerequisites, a **Before you begin** section that lists exactly what you need, numbered single-move steps with a verification line for each, a **Troubleshooting** section covering the three or four issues that actually come up, and a closing that names where the building block plugs in next. Integration tutorials (Office add-in, Meetily, local provider) carry an extra **Privacy notes** or **Trust boundary** section that names what crosses the network in each direction.

If a step looks like it does two things at once, read it again — every step has one move and one verification. Skipping a section assuming you already have its prerequisite is the most common way a tutorial fails halfway through; the next step usually depends on the exact field the skipped section configures.

## Pages in this section

- **[Chat effectively](/tutorials/member/chat-effectively)** — Member-role tutorial that combines the agent selector, attachments, dictation, and Canvas into a daily chat workflow.
- **[Build your first agent end to end](/tutorials/editor/first-agent-end-to-end)** — Editor-role tutorial that takes you from an empty agent page to a versioned, knowledge-scoped agent your team can pick in chat.
- **[Call Tale from a script](/tutorials/developer/call-tale-from-a-script)** — Developer-role tutorial that issues a chat request from cURL and Python against Tale's OpenAI-compatible API.
- **[Trigger an automation via webhook](/tutorials/developer/trigger-automation-via-webhook)** — Developer-role tutorial that wires an external system into a Tale workflow via the unique webhook URL.
- **[Word & Excel add-in](/tutorials/admin/office-add-in)** — Admin-role integration tutorial that routes a sideloaded AI panel inside Microsoft 365 through a Tale agent.
- **[Meeting transcription](/tutorials/admin/meeting-transcription)** — Admin-role integration tutorial that pairs Tale with Meetily so raw audio stays on the laptop and only the transcript reaches your instance.
- **[Connect a local provider](/tutorials/admin/connect-local-provider)** — Admin-role integration tutorial that adds Ollama or vLLM as a Tale AI provider so model inference stays inside your network.

## Where this fits

The tutorials cover the four canonical entry points into Tale — Member, Editor, Developer, Admin — and three integration pairings on top. For the conceptual model behind each tutorial, the corresponding page under [Platform](/platform) is the reference; for the API and SDK surfaces the developer tutorials build on, [Develop](/develop/api-reference) is one tab over.
