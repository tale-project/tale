---
title: How usage is counted
description: Who each chat reply, agent run, or voice request counts against, which limits apply, and where it appears in Usage analytics.
---

Every AI request Tale makes for your organization is recorded once, against one person, and measured against the [budget rules](/platform/admin/governance/policies-and-limits) that apply to that person. This page explains who that person is for each kind of work, which limits the work counts against, and where you find it in [Usage analytics](/platform/admin/governance/usage-analytics). Members see their own share under [Settings > Usage](/platform/member/preferences#usage-limits).

## What counts as usage

Tale records a request whenever a model or a metered service runs for your organization: a chat reply, including a regenerated or edited one and both sides of a model comparison; the short model call that names a new chat; a rewrite with **Improve with AI** in the inbox; the model call of an automation's `llm` step; a turn of a managed agent working on a task or inside an automation; an image such an agent generates; voice output; the transcription of an uploaded recording or of a dictation; the embeddings that index knowledge and those every knowledge search asks for; and a call to the model endpoints with an API key. Each record carries the tokens or units used — for a transcription, the minutes of audio — and the cost estimated from the provider's list price at that moment; for a model endpoint call, it is the cost the model gateway measured.

Tale also counts every call it makes through a connector — the assistant's search and web tools, an agent's or an automation's connector step, an email sent from the inbox — as a connector call, at no cost. A connector call is never a request: request limits count model requests alone.

## Who a request counts against

The rule is the same everywhere: a request counts against the person who asked for the work. The door the request came through, such as the app, the REST API, the MCP endpoint, or the model endpoints, changes nothing about who that is.

| Work | Counts against | Also counts toward | Appears in Usage analytics as |
| --- | --- | --- | --- |
| A chat reply, or the title of a new chat | The member who sent the message | The API key, when the message was sent through the REST API | The assistant used; a title under `thread-title` |
| A rewrite with **Improve with AI** in the inbox | The member who asked for it | — | `inbox-improve` under **Top assistants** |
| An agent run on a task | The member who started the run from the task, or with a comment or a task description that mentions the agent; for a run another agent or an automation step started, the member that agent's or automation's run counts against | — | The agent's name under **Top assistants** |
| An automation run someone started | The member who started it from the run list, the builder, a chat, a task, the REST API, or the MCP endpoint | The API key, when the run was started with one | The automation's name under **Top assistants** |
| An automation run a trigger started | Nobody: a schedule, a webhook, or an event has no person behind it | — | The **Automations (triggers)** row under **Per-user usage** |
| A project agent's run a schedule began, or one another agent started for such a run | Nobody, as for the schedule's own run | — | The **Automations (triggers)** row under **Per-user usage**, and the agent's name under **Top assistants** |
| An image an agent generates | The person the agent's run counts against: its starter, or nobody for a run a trigger started | The API key, when the run was started with one | The agent's or automation's name under **Top assistants**, and the image model under **Top models** |
| Voice output or a transcription | The member who requested it; for a recording's transcription, whoever added the recording, a retry included | — | **Voice output** or **Transcription** under **Top assistants**; voice output also under **Top voice models** |
| Knowledge indexing and search (embeddings) | Indexing: the member who added the file — the owner of a synced drive — or the organization for an emailed attachment, an inbound email and a website scan a schedule started. A search: the member searching | The API key a search, or a website added through the API, came with | **Knowledge indexing and search** under **Top assistants** |
| A connector call: an assistant's search or web tool, an agent's or an automation's connector step, an email sent from the inbox | The member who made it; for an agent's or an automation's step, whoever its run counts against; for an email, the member who sent it | The API key it came with | Not as a request: connector calls are counted apart and add nothing to the request figures |
| A call to the [model endpoints](/develop/use-tale-from-your-editor#model-endpoints) | The member whose API key sent it | The API key | **Direct API** under **Top assistants** |

A retry of an agent run continues the run its starter kicked off, so its usage stays with that person. When an integration uses an API key to act for another member, the run counts against the member acted for, and the key's own limit counts it too.

Work in a project also counts toward that project, whoever asked for it: the project's chats, with their titles, the answers read aloud, the recordings transcribed in them, and the assistant's tool calls and searches; the files indexed for it; the runs of its agents and the agent and `llm` steps of automations run in it, with the images they generate; and the calls made with the project's own API keys. A run that names no project, of an automation installed in several projects, counts toward each of them; an automation installed in no project counts toward the organization alone.

Chat turns, voice attempts and automation model calls keep the projects recorded when admitted. Moving the chat or changing an automation’s project installations while work is running does not move its reservation or eventual booking. An attempt admitted without a project stays outside project budgets.

An API key an Admin made for a member counts against that member, like the member's own key. A key that belongs to a team, a project, or the organization ([API keys](/platform/admin/api-keys#create-a-key-for-someone-else)) is not a person: what it asks for counts against the key itself. Usage analytics shows it as a row of its own under **Per-user usage**, under the key's name with its team, project, or organization beneath, and never counts it as an active user. A team's key also counts toward its team's usage.

## Which limits apply

- **Personal, team, and role limits** bind the person a request counts against. A run a schedule, a webhook, or an event started has no such person and is not measured against any of them. Neither is a team's, a project's, or the organization's own key, except that a team's key is held to its team's limit.
- **Organization limits** bind every request, including trigger-started runs.
- **API-key limits** bind the requests authenticated with that key: the chat messages it sent, its model endpoint calls, and the runs it started.
- **Project limits** bind the work in that project, whoever asked for it, including runs a trigger started.

When a limit is reached, Tale refuses the next request before it runs and names the limit. A managed agent turn is refused at its start; a turn already running keeps the allowance it was given. An image the agent asks for during its turn is checked on its own before the image model is called, so a reached limit refuses the image while the turn continues. The image also draws on the allowance of the turn that asked for it. An automation's `llm` step is checked before each model call: a call a limit refuses fails the step with `budget_exceeded`, and its error names the limit; the run fails with it unless the step's `onError` is `continue`. The step reserves its estimated prompt and permitted output at the catalog price, plus one request, until settlement. Concurrent calls therefore see each other’s reservations. If the provider’s outcome is unknown, Tale books the saved estimate once instead of silently freeing it; a retry is a new admission. A chat's title, a rewrite with **Improve with AI** and a transcription are checked the same way before Tale calls the model, against an estimate of the most the call may cost — for a written reply, its prompt and the longest answer the call allows; for a transcription, the recording's length, its long silences cut, at the model's price per minute — and hold that amount while the call runs. A refused title is no error: the chat is named from its first message instead, without a model call. A transcription model the catalog has no per-minute price for — one billed by tokens, or an endpoint that publishes no price — counts toward request limits only, at no cost. A refused transcription reads **Usage limit reached**; choose **Try again** once the limit allows it. A refused dictation says the limit was reached, and a video link is refused before its download. Each embedding request is checked the same way. A knowledge search a limit refuses says so, and never answers "nothing found"; indexing waits instead: a document shows **Waiting for a usage limit**, a website keeps its pages without search by meaning, and both resume by themselves within the hour after the limit resets or is raised. A chat reply also holds each further round of its tool use as the round starts. [How rules combine](/platform/admin/governance/policies-and-limits#how-rules-combine) covers the case of several rules applying to one person.

Voice output holds its estimated cost and one request while pending. A reserved attempt that fails or has an unknown outcome records that estimate once, including failures before the provider call; this is conservative accounting, not confirmation of a charge. A retry includes the earlier estimate when checking the remaining budget.

## Three situations worth knowing

**A teammate mentions your agent in a task comment or a task description.** Posting the comment or saving the description starts a run, and that run counts against the teammate who wrote it, not against you as the agent's creator.

**A scheduled automation spends every night.** Its runs appear on the **Automations (triggers)** row. They never raise anyone's personal usage or the active-user count, and only the organization's limits can stop them, or a project's limits when the automation runs in a project. Set an organization or project cost or request limit when you need a ceiling for them.

**An integration uses an API key on behalf of a member.** The member's personal and team limits see the run, and so does the key's limit. Two ceilings apply, and the stricter one refuses first.

## What members see

**Settings > Usage** lists every limit that applies to the signed-in member with its current usage: the chats they sent, the voice output they requested, the model endpoint calls they made, and the agent and automation runs they started, whichever way they started them. Shared team and organization limits appear there too, because they can be reached before a personal one. A project's limit does not appear there; a request it refuses names it.
