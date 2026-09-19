---
title: How usage is counted
description: Who each chat reply, agent run, or voice request counts against, which limits apply, and where it appears in Usage analytics.
---

Every AI request Tale makes for your organization is recorded once, against one person, and measured against the [budget rules](/platform/admin/governance/policies-and-limits) that apply to that person. This page explains who that person is for each kind of work, which limits the work counts against, and where you find it in [Usage analytics](/platform/admin/governance/usage-analytics). Members see their own share under [Settings > Usage](/platform/member/preferences#usage-limits).

## What counts as usage

Tale records a request whenever a model or a metered service runs for your organization: a chat reply, including a regenerated or edited one and both sides of a model comparison; the short model call that names a new chat; a turn of a managed agent working on a task or inside an automation; voice output; the transcription of an uploaded recording; and a metered connector call. Each record carries the tokens or units used and the cost estimated from the provider's list price at that moment.

## Who a request counts against

The rule is the same everywhere: a request counts against the person who asked for the work. The door the request came through, such as the app, the REST API, or the MCP endpoint, changes nothing about who that is.

| Work | Counts against | Also counts toward | Appears in Usage analytics as |
| --- | --- | --- | --- |
| A chat reply, or the title of a new chat | The member who sent the message | The API key, when the message was sent through the REST API | The assistant used; a title under `thread-title` |
| An agent run on a task | The member who started the run from the task or with a comment that mentions the agent | — | The agent's name under **Top assistants** |
| An automation run someone started | The member who started it from the run list, the builder, a chat, a task, the REST API, or the MCP endpoint | The API key, when the run was started with one | The automation's name under **Top assistants** |
| An automation run a trigger started | Nobody: a schedule, a webhook, or an event has no person behind it | — | The **Automations (triggers)** row under **Per-user usage** |
| Voice output or a transcription | The member who requested it | — | **Voice output** or **Transcription** under **Top assistants**; voice output also under **Top voice models** |
| A metered connector call | The member whose request made the call | — | The assistant that made it, or **Connector** |

A retry of an agent run continues the run its starter kicked off, so its usage stays with that person. When an integration uses an API key to act for another member, the run counts against the member acted for, and the key's own limit counts it too.

## Which limits apply

- **Personal, team, and role limits** bind the person a request counts against. A run a schedule, a webhook, or an event started has no such person and is not measured against any of them.
- **Organization limits** bind every request, including trigger-started runs.
- **API-key limits** bind the requests authenticated with that key: the chat messages it sent and the runs it started.

When a limit is reached, Tale refuses the next request before it runs and names the limit. A managed agent turn is refused at its start; a turn already running keeps the allowance it was given. [How rules combine](/platform/admin/governance/policies-and-limits#how-rules-combine) covers the case of several rules applying to one person.

## Three situations worth knowing

**A teammate mentions your agent in a task comment.** The comment starts a run, and that run counts against the teammate who wrote the comment, not against you as the agent's creator.

**A scheduled automation spends every night.** Its runs appear on the **Automations (triggers)** row. They never raise anyone's personal usage or the active-user count, and only the organization's limits can stop them. Set an organization cost or request limit when you need a ceiling for them.

**An integration uses an API key on behalf of a member.** The member's personal and team limits see the run, and so does the key's limit. Two ceilings apply, and the stricter one refuses first.

## What members see

**Settings > Usage** lists every limit that applies to the signed-in member with its current usage: the chats they sent, the voice output they requested, and the agent runs they started, whichever way they started them. Shared team and organization limits appear there too, because they can be reached before a personal one.
