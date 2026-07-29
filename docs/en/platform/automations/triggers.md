---
title: Automation triggers
description: The three ways an automation starts on its own — a schedule, a webhook, or a platform event — what each carries into the run, and why none of them break when you deploy.
---

A trigger is what starts an automation when nobody is clicking anything. There are exactly three kinds, the set is closed, and an automation may carry several of them at once. The single most useful thing to know about a trigger is that it binds to the automation's **name** and not to a version, which is why deploying a new version never invalidates a webhook URL an external system depends on and never drops a schedule.

Every trigger fires against the automation's deployed version and runs in live mode, so an automation with no deployment cannot be started by one. Each trigger carries an on-off switch and records when the scheduler last acted on it.

## The three kinds

| Kind       | Starts the automation when …                         |
| ---------- | ---------------------------------------------------- |
| `schedule` | A cron expression comes due in a named IANA timezone |
| `webhook`  | An external system posts to a token-guarded URL      |
| `event`    | A named platform event happens                       |

A programmatic start needs no trigger at all: an API client with an organization key calls `POST /api/v1/automations/{name}/runs` (or the MCP `start_run` tool) and the key itself is the entitlement — see the [API reference](/develop/api-reference).

## Schedules

A schedule carries a five-field cron expression and the IANA timezone it is read in. The fields are minute, hour, day of month, month, and day of week, and each accepts a `*`, a number, a range, a step, or a comma-separated list of those.

```text
*/15 * * * *     every fifteen minutes
0 9 * * 1-5      09:00 on weekdays
0 6 1 * *        06:00 on the first of the month
30 8 1 * 1       08:30 on the 1st and on every Monday
```

Day of week runs 0 to 7 with both 0 and 7 meaning Sunday. When you restrict both day of month **and** day of week, a day matching either one fires — the same rule crontab uses, which is what makes the last example read the way it behaves.

The timezone is resolved as wall-clock time, so a schedule written for 09:00 in `Europe/Zurich` stays at 09:00 across a daylight-saving change instead of drifting an hour twice a year. A schedule that names no timezone is read in UTC.

Resolution is one minute, and a schedule is a heartbeat rather than a queue: after an outage the automation resumes at its next occurrence instead of replaying the ones it missed. A schedule whose cron expression cannot be parsed is skipped rather than stopping the platform's other schedules, and its last-fired time stops advancing — which is the signal to go and read it.

## Webhooks

A webhook is an inbound URL guarded by a token. Creating one mints the token and shows it once; only its hash is stored, so the platform can verify a caller without ever being able to reproduce the URL. Any system that posts to it starts a run, and the request body becomes the run's payload.

```bash
curl -X POST https://<your-tale-host>/api/automations/webhook/<token> \
  -H 'Content-Type: application/json' \
  -d '{"invoiceId": "inv-1"}'
```

A successful call is accepted immediately and answers with the id of the run it started, so the caller never waits for the automation to finish. A body that is not JSON is handed through as text rather than refused, because some vendors post form or plain-text payloads. Bodies are capped at 256 KB — a webhook takes a payload, not an upload.

Two refusals are worth recognising. An unknown token and a token belonging to a switched-off trigger both answer the same way, deliberately, so that nobody can probe the platform for which tokens exist. An automation with no deployed version answers with a conflict instead, which tells you the URL is fine and the deployment is missing.

<Warning>

The token in the URL is the credential. Anyone holding the URL can start the automation, so store it the way you store a password, hand it out over a secure channel, and delete the trigger to revoke it — there is no way to recover the token afterwards.

</Warning>

## Events

An event trigger names a platform event and fires whenever that event happens in the organization. The event's payload becomes the run's input, which makes this the kind to reach for when the automation's job is to react to something the platform itself just did.

<Note>

An event raised by an automation's own run never fires triggers. An automation that writes a record, which raises an event, which starts the same automation, is an unbounded loop that no per-run limit can stop, so the platform refuses at the point of dispatch instead.

</Note>

## What each kind carries into the run

The input an automation receives says which kind started it, so a single document can serve more than one trigger and branch on the difference.

| Kind       | The run's input                                           |
| ---------- | --------------------------------------------------------- |
| `schedule` | The trigger kind and the occurrence time it fired for     |
| `webhook`  | The trigger kind and the posted body as the payload       |
| `event`    | The trigger kind, the event name, and the event's payload |

An API-started run carries exactly the `input` the caller sent.

Declare the shape you expect in the document's `inputs` schema and the reference to it validates before the automation ever runs.

## Deploying does not disturb them

Because a trigger names the automation rather than a version, the whole set survives every deploy and every rollback. Publish a webhook URL to a partner, deploy eleven more versions, roll back twice, and that URL keeps working and keeps hitting whatever is live at the time.

The same holds in the other direction: adding, editing, or removing a trigger changes nothing about the document or its versions. Triggers and versions are two independent things about the same automation.

## Turning one off without losing it

Every trigger has an enabled flag, and switching it off is the way to stop an automation firing without giving anything up. A disabled schedule stops coming due, a disabled webhook URL stops being honoured, and a disabled event trigger stops matching — while the row, its configuration, and the automation's whole run history stay exactly where they were. Switch it back on and it resumes.

Deleting a trigger is the permanent version of the same thing, and for a webhook it is also how you revoke the URL. Reach for the switch when you want a pause and for deletion when you want the credential gone.

## Where this fits

Three kinds, one behaviour: each starts the deployed version in live mode, each records when it last fired, and each can be paused without being lost — and none of them care how many times you have deployed since. [Automation concepts](/platform/automations/concepts) explains why binding to the name is what makes that true; [Execution logs](/platform/automations/execution-logs) shows the runs your triggers produced and which one started each.
