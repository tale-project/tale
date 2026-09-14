---
title: Start automations automatically
description: Configure schedules, webhooks and platform events, match their input shape and diagnose missed starts.
---

Use the automation’s **Trigger** panel when work should start on a schedule or in response to an event. Every trigger starts the deployed version in live mode. Before enabling one, test the workflow with the input shape it will receive and check that its external actions are ready.

## Choose how the automation starts

| Trigger type | Use it for | Input passed to the run |
| --- | --- | --- |
| **Schedule** | Periodic work at a local time or regular interval. | `{ trigger: "schedule", firedAt: "…" }` |
| **Webhook** | A delivery from another system. | `{ trigger: "webhook", payload: … }` |
| **Platform event** | A named event inside the organization. | `{ trigger: "event", event: "…", payload: … }` |

An automation has one configured trigger at a time. Changing its type replaces the previous binding. Replacing a webhook revokes its URL immediately; configuring another webhook later does not recover that credential.

An API or MCP client can also start work without a configured trigger. Its API key and project permissions authorize the request, and it sends the workflow’s input directly. See the [API reference](/develop/api-reference).

## Set a schedule

<Steps>

<Step title="Open the trigger settings">

Open the automation and its **Trigger** panel. Choose **Schedule** under **Trigger type**. Keep **Enabled** off while preparing a workflow that should not start yet.

</Step>

<Step title="Enter the timing">

Fill **Cron** and choose **Timezone**. A cron expression has five fields: minute, hour, day of month, month and day of week. Use an IANA timezone such as `Europe/Zurich` when local business hours matter; an unspecified timezone means UTC.

</Step>

<Step title="Check and save">

Review the next occurrence shown for a valid expression, then save the settings. Confirm that the workflow’s deployed version accepts the schedule input above. When ready, enable the trigger and save. Check the next started run under **Runs**.

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

Choose **Webhook**, then save to generate the credential. Copy the full URL when it appears: the token is shown once and only its hash is stored. The panel supplies an organization URL and a project URL pattern. Use the project URL for an active project in which the automation is installed; an automation with project bindings cannot run through the organization-only URL.

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

A workflow expecting required top-level fields such as `owner` and `repo` cannot accept schedule metadata or a wrapped webhook unchanged. Adapt its input schema and references, or use an API-started run that supplies those fields. The trigger panel does not provide arbitrary saved input fields.

## Diagnose a missing start

First check **Enabled**, the deployed version and the last-fired information. Then inspect any recorded skip reason:

| Reason or symptom | What to check |
| --- | --- |
| `not_deployed` | Deploy a tested version. A saved draft is insufficient. |
| `start_refused` | Compare the deployed input schema with the trigger’s actual wrapper and resolve the reported validation or start error. |
| `unusable_cron` | Correct the expression or timezone and save it again. Other schedules continue while this one is skipped. |
| Webhook credential refused | Check the current URL and enabled state. Unknown and disabled tokens intentionally receive the same refusal. |
| Run exists but did not finish | Open [execution logs](/platform/automations/execution-logs); the start succeeded and the issue is inside the run. |

The last-fired timestamp advances when a run actually starts. A due trigger that cannot start work records a skip instead. This separates a broken schedule from a workflow that started and later failed.

## Pause or replace the trigger

Turn off **Enabled** and save to pause starts while retaining the configuration and run history. Re-enable it to resume. **Remove trigger** deletes the binding; for a webhook, its URL becomes unusable.

Triggers belong to the automation’s name, not a version. Deploying or rolling back keeps the same schedule or URL and changes which version future starts execute. Editing a trigger does not create a workflow version, so review trigger settings alongside any deployment that changes expected inputs.
