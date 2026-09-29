---
title: Start automations automatically
description: Configure schedules, webhooks and platform events, match their input shape and diagnose missed starts.
---

Use the **Trigger** section on the automation’s **General** tab when work should start on a schedule or in response to an event. Every trigger starts the deployed version in live mode. Before enabling one, test the workflow with the input shape it will receive and check that its external actions are ready.

## Choose how the automation starts

| Trigger type | Use it for | Input passed to the run |
| --- | --- | --- |
| **Schedule** | Periodic work at a local time or regular interval. | `{ trigger: "schedule", firedAt: <epoch ms> }` |
| **Webhook** | A delivery from another system. | `{ trigger: "webhook", payload: … }` |
| **Platform event** | A named event inside the organization. | `{ trigger: "event", event: "…", payload: … }` |

An automation has one configured trigger at a time. Changing its type replaces the previous binding. Replacing a webhook revokes its URL immediately; configuring another webhook later does not recover that credential.

An API or MCP client can also start work without a configured trigger. Its API key and project permissions authorize the request, and it sends the workflow’s input directly. See the [API reference](/develop/api-reference).

## Set a schedule

<Steps>

<Step title="Open the trigger settings">

Open the automation, then its **General** tab. Without a binding, the **Trigger** section says that the automation runs only when started by hand or through the API; choose **Add trigger**, then **Schedule** under **Trigger type**. A new trigger starts with **Enabled** off — keep it off while preparing a workflow that should not start yet.

</Step>

<Step title="Enter the timing">

Fill **Cron** and choose **Timezone**. A cron expression has five fields: minute, hour, day of month, month and day of week. Use an IANA timezone such as `Europe/Zurich` when local business hours matter; an unspecified timezone means UTC.

</Step>

<Step title="Check and save">

Review the next occurrence shown for a valid expression: it is the minute the schedule will actually start, daylight-saving changes included. Then click **Save** beside the tabs. Confirm that the workflow’s deployed version accepts the schedule input above. When ready, turn on **Enabled** and save again. Check the next started run under **Runs**.

</Step>

</Steps>

```text
*/15 * * * *     every fifteen minutes
0 9 * * 1-5      09:00 on weekdays
0 6 1 * *        06:00 on the first of the month
30 8 1 * 1       08:30 on the 1st and on every Monday
```

Fields support `*`, numbers, ranges, steps and comma-separated lists. Both 0 and 7 mean Sunday. If both day-of-month and weekday are restricted, either match is enough; the last example runs on Mondays as well as the first day of each month.

Local time follows the timezone’s daylight-saving rules. A 09:00 Zurich schedule stays at 09:00 locally. Timing has one-minute resolution. Missed occurrences during an outage are not replayed; work resumes at the next occurrence. Impossible calendar dates are rejected when saving.

## Receive a webhook

Choose **Webhook**, then save to generate the credential. Copy the full URL when it appears: the token is shown once and only its hash is stored. The section supplies an organization URL and a project URL pattern. Use the project URL for an active project in which the automation is installed; an automation with project bindings cannot run through the organization-only URL.

Post a small payload to the URL. JSON becomes `payload` inside the input wrapper, not the workflow’s top-level input. Other request bodies pass through as text. The limit is 256 KiB; upload large documents separately. An accepted request returns a run ID without waiting for completion.

For example, a posted `{ "invoiceId": "inv-1" }` reaches the workflow as:

```json
{
  "trigger": "webhook",
  "payload": { "invoiceId": "inv-1" }
}
```

Use a delivery ID, such as `Idempotency-Key` or the sender’s supported delivery header. Repeating that ID within 24 hours returns the original run. Without an ID, an identical body on the same URL within two minutes is treated as a duplicate. Send distinct IDs if identical payloads represent separate work. [Webhooks](/develop/webhooks) lists supported headers, project routes, errors and response formats.

<Warning>

The URL authorizes a run. Store it as a credential and share it only with the sending system. **Rotate token** generates a replacement and invalidates the old URL; removing or replacing the trigger also revokes it. Update the sender after a rotation.

</Warning>

## React to a platform event

Choose **Platform event**, select **Event name**, then save and enable when ready. Match the workflow’s schema to the `trigger`, `event` and `payload` wrapper in the table. Events raised by automation runs do not fire triggers, preventing a workflow from repeatedly starting itself through its own changes.

A workflow expecting required top-level fields such as `owner` and `repo` cannot accept schedule metadata or a wrapped webhook unchanged. Adapt its input schema and references, or use an API-started run that supplies those fields. The trigger settings do not provide arbitrary saved input fields.

## Start a project agent on a schedule

A schedule can put one of a project's existing agents to work: a standing task the agent reports on at every occurrence, or recurring work you would otherwise start by hand. Install the automation in the task's project, add a `task.start_agent` step that names the task, and give the automation a schedule. Each occurrence starts the task's agent assignee, or first assigns the task to the agent `agentId` names, which must belong to the same project. `feedback` is the message the run addresses first, such as the occurrence it serves:

```yaml
nodes:
  - id: start
    type: task.start_agent
    input:
      taskId: <the task's ID>
      moveToInProgress: false
      feedback: 'Scheduled occurrence {{ input.firedAt }}.'
```

The step answers the run it started, and the task's timeline lists that run as **automation** with a link to the automation run. When it starts nothing, the step still succeeds and says why, so the occurrence is recorded rather than queued:

| Answer | Meaning |
| --- | --- |
| `started: true` | The agent's run started; `runId` names it. |
| `already_running` | The task's previous run is still working and carries the work. Nothing new starts, and the occurrence does not wait behind it. |
| `in_review` | With `moveToInProgress: false`, the card waits for a person's review. Nothing is assigned or started, and the review stays with the person. |
| `closed` | With `moveToInProgress: false`, the card is **Done** or **Cancelled** (`taskStatus`). Nothing is assigned or started. |
| `agent_busy` | The agent is working another task (`busyTaskId`). An agent works one task at a time in its workspace. |
| `blocked` | A task this one depends on is still open (`blockedBy`). |
| `paused` | The task took three starts by automations and agents within the last hour. `retryAfter` says when the next one is admitted. |

A run a schedule starts answers to no person. It works with the agent's configured instructions, secrets and tools, and its spend counts as automation spend against the organization's limits. Connector actions it asks the platform to run act for nobody, so they are refused. It keeps that authority only while the schedule may act in the project: turning the schedule off, removing it, or uninstalling the automation from the project stops the next start, fails a run that has not launched yet, and ends the workspace tools of a run in progress. A run a person starts from the automation answers to that person instead, as long as they can edit the project. A run a webhook or a platform event started cannot start agents, and an automation that is not installed in the task's project cannot reach its agents.

`moveToInProgress` decides what happens to the card. By default the card moves to **In progress** and the result waits at **In review** for a person, as after **Start agent**; a review still pending on the earlier work is withdrawn, never approved. With `false` the card stays where it is and the run asks for no review, which suits a standing task in **To do**. That start only runs under open work (**Backlog**, **To do** or **In progress**): a card waiting at **In review** answers `in_review` and a closed one `closed`, so the card never presents earlier work for judgment, or as finished, while new work runs under it. Such a run is not retried automatically when it fails; the next occurrence starts it again.

### Import every issue on a schedule

An issue import reads at most one batch per run, up to 500 issues, and answers where the next batch starts. A person continues it with **Continue import**; a schedule keeps the position between its occurrences instead, so each occurrence imports one batch from where the last one stopped until every open issue has been read, and the occurrence after that starts the next pass. Read the position with `task.get_import_cursor`, pass it to the importer, and save the importer's `nextCursor` with `task.save_import_cursor`:

```yaml
nodes:
  - id: position
    type: task.get_import_cursor
    onError: continue
    input: { projectId: <the project's ID>, externalSystem: github, source: owner/repo }
  - id: issues
    type: subautomation
    automation: github-import-issues
    onError: continue
    input:
      projectId: <the project's ID>
      owner: owner
      repo: repo
      limit: 500
      cursor: '{{ nodes.position.output.cursor }}'
  - id: progress
    type: task.save_import_cursor
    onError: continue
    input:
      projectId: <the project's ID>
      externalSystem: github
      source: owner/repo
      from: '{{ nodes.position.output.cursor }}'
      next: '{{ nodes.issues.output.nextCursor ?? "" }}'
```

`source` is your name for the listing; automations that name the same source share one pass. The position advances only when the save still finds the cursor the batch started at. An import that fails saves nothing, so the next occurrence retries the same batch, and an overlapping run cannot move the pass backwards. After three reads of one position without a save, the next read starts the pass over (`restarted`) instead of retrying a position the source keeps refusing, for example after the repository was renamed. The save answers `batch` and `drained`, which a receipt can report. Each run also refreshes up to 500 issues imported earlier, the longest-unchecked first, so a large collection is refreshed over several occurrences.

## Diagnose a missing start

First check **Enabled**, the deployed version and the last-fired information. Then inspect any recorded skip reason:

| Reason or symptom | What to check |
| --- | --- |
| `not_deployed` | Deploy a tested version. A saved draft is insufficient. |
| `start_refused` | Compare the deployed input schema with the trigger’s actual wrapper and resolve the reported validation or start error. |
| `unusable_cron` | Correct the expression or timezone and save it again. Other schedules continue while this one is skipped. |
| `paused_after_failures` | The schedule turned itself off after repeated failures. See [When a schedule pauses itself](#when-a-schedule-pauses-itself). |
| Webhook credential refused | Check the current URL and enabled state. Unknown and disabled tokens intentionally receive the same refusal. |
| Run exists but did not finish | Open [execution logs](/platform/automations/execution-logs); the start succeeded and the issue is inside the run. |

The last-fired timestamp advances when a run actually starts. A due trigger that cannot start work records a skip instead. This separates a broken schedule from a workflow that started and later failed.

## When a schedule pauses itself

A schedule whose runs fail the same way at every occurrence would otherwise keep failing indefinitely. Tale counts the runs a trigger starts that fail with an error a retry won't fix: the automation's own code (`node_error`), a connector (`connector_error`), a model reply that does not match its schema (`llm_output_invalid`), or the organization's model provider (`auth_error`, `missing_api_key`, `credit_exhausted`, `model_not_found`). A successful run resets the count, and other failures, such as a rate limit or an unreachable provider, neither count nor reset it. A schedule that has already paused itself is the exception: it keeps the count that paused it, even when a run that was still in progress succeeds afterwards, and only saving the trigger clears it.

After five such failures in a row, the schedule turns **Enabled** off and records `paused_after_failures`. The **Trigger** section then shows the pause, the last failure's code and time, and **View run**, which opens that run. While runs are failing but the schedule is still on, the section shows how many failed in a row. Owners and Admins get a bell notification, which also reaches them by email when the organization has a connected mailbox, and the audit log records the pause. They can switch these notices off with **Automation alerts** under **Settings > Notifications**.

Open the failed run to read the error, and fix the automation or its connection. Then turn on **Enabled** and save. Saving the trigger starts a new count, whether it turns the schedule back on or leaves it off, and marks the notices read.

Webhook and platform-event triggers count failures the same way but are never paused. Their runs carry a delivery or an event, which a paused trigger would drop.

## Pause or replace the trigger

Turn off **Enabled** and save to pause starts while retaining the configuration and run history. Re-enable it to resume. **Remove trigger** deletes the binding; for a webhook, its URL becomes unusable.

Triggers belong to the automation’s name, not a version. Deploying or rolling back keeps the same schedule or URL and changes which version future starts execute. Editing a trigger does not create a workflow version, so review trigger settings alongside any deployment that changes expected inputs.
