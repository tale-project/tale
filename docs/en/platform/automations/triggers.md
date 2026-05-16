---
title: Triggers
description: How automations start — schedules, webhooks, events, and manual runs.
---

A trigger names the moment an automation starts and the input it starts with. Tale ships four kinds — schedules, webhooks, events, and manual runs — and one automation can carry any mix of them, so the same fan-out can run on a nightly schedule and on every inbound webhook from an outside system. This page is for the Developer or higher wiring an automation up; the configuration surface is the **Triggers** tab on any automation.

## Schedules

A schedule runs the automation on a clock. Open **Triggers > Schedules > Add schedule** and either type a cron expression directly (`0 9 * * 1-5` runs at 09:00 on weekdays) or describe what you want in plain language — "every weekday at 9am" — and let the AI assistant translate. The five quick presets (every five minutes, hourly, daily, weekly, monthly) cover the common cases without typing.

Each schedule runs in **UTC**. If your team thinks in another timezone, do the conversion before you save — `0 9 * * 1-5` is 09:00 UTC, which is 10:00 in Zurich winter time and 11:00 in summer. The **Workflow variables** field on the schedule form lets you pin a JSON payload that the run starts with; it is pre-filled from the automation's input schema, so the common case is editing values rather than writing the shape from scratch.

## Webhooks

A webhook gives the automation a URL outside callers can POST to. Open **Triggers > Webhooks > Add webhook** and Tale generates a URL of the form:

```text
https://<your-tale-host>/api/workflows/wh/<token>
```

The token in the URL is the credential — anyone holding it can fire the automation, so treat it like an API key. Store it in the calling system's secret store, rotate it by deleting and re-adding the webhook, and audit it with [Audit log](/platform/admin/governance#audit-log) when something looks off. There is no separate signature header.

A working call looks like this:

```bash
curl -X POST https://your-tale-host/api/workflows/wh/abc123def456 \
  -H "Content-Type: application/json" \
  -d '{"orderId": "ord_42", "amount": 199.00}'
```

The body is parsed as JSON and made available as the automation's input. The response is `{ "status": "accepted", "workflowSlug": "..." }` for a fresh call. Send an `X-Idempotency-Key` header with a unique value if the calling system might retry the same request — Tale will recognise the retry and respond with `{ "status": "duplicate", "executionId": "..." }` instead of starting a second run.

Webhooks are rate-limited per source IP so a noisy caller can not exhaust the engine; calls past the limit return `429`. The full request/response reference, including signatures for the legacy Tale-signed scheme on older webhook shapes, lives at [Webhooks](/develop/webhooks).

## Events

An event trigger runs the automation when something happens inside Tale. Open **Triggers > Events > Add event trigger**, pick an event type, and add a filter if the event needs one.

| Event type                      | Fires when                                                        |
| ------------------------------- | ----------------------------------------------------------------- |
| `customer.created`              | A customer record is added (manually, by import, or via the API). |
| `customer.updated`              | A customer record changes.                                        |
| `customer.deleted`              | A customer record is deleted.                                     |
| `conversation.created`          | A new conversation is opened in the inbox.                        |
| `conversation.message_received` | A reply arrives on an existing conversation.                      |
| `conversation.closed`           | A conversation is marked closed.                                  |
| `workflow.completed`            | Another automation finishes successfully. Filterable by source.   |

The filter is evaluated before the automation starts — non-matching events are skipped without leaving a run on the **Executions** tab. The `workflow.completed` event in particular is how you chain automations: one finishes, another picks up its output and continues the work.

## Manual runs

The **Test automation** button in the editor and the **Run** action on a published automation both fire a one-off run with input you supply. Manual runs share the engine with scheduled and webhook runs but show up on the **Executions** tab with the trigger source labelled `manual` — useful for trying a new automation before scheduling it, for one-off backfills, and for replaying a payload from a past failed run after you have fixed the bug.

## Multiple triggers on one automation

An automation with two triggers — say, a nightly schedule and an inbound webhook — runs once per trigger that fires. Every run records which trigger started it, so the **Executions** tab and the metrics dashboard both show the source breakdown without losing the per-run trace. Mixing triggers is the right move when the same work has to happen on a clock and on demand; do not duplicate the automation just to assign a different trigger.

## Where this fits

Triggers are the boundary between Tale and everything that wants to start an automation. The four kinds cover almost every shape of "start now": regular work on a schedule, reactive work on an event, integrated work on a webhook, exceptions on a manual run. The development-side reference for the webhook URL shape, idempotency, and rate limits is [Webhooks](/develop/webhooks); the per-run trace each trigger leaves behind is [Execution logs](/platform/automations/execution-logs).
