---
title: Triggers
description: How workflows start — schedules, events, webhooks, and manual runs.
---

Every workflow needs at least one trigger. The trigger defines _when_ the workflow starts and _what input_ it starts with. A workflow can have multiple triggers of the same or different kinds.

Triggers are configured on the workflow's **Start** step.

## Schedule triggers

Run the workflow on a time schedule.

- Enter a cron expression directly (`0 9 * * 1-5` runs at 9 am UTC on weekdays).
- Or use the AI assistant next to the field to generate cron from plain English ("every weekday at 9am").
- Quick presets: every 5 minutes, hourly, daily, weekly, monthly.

All schedules run in **UTC**. If your team is in a different timezone, convert before entering the cron expression.

## Event triggers

Run the workflow when something happens inside Tale.

| Event                     | Example use                                     |
| ------------------------- | ----------------------------------------------- |
| New customer added        | Send a welcome email.                           |
| New conversation opened   | Tag the thread based on the customer's history. |
| Approval requested        | Notify a Slack channel.                         |
| Document uploaded         | Extract metadata and classify.                  |
| Product stock ≤ threshold | Re-order or alert purchasing.                   |

Each event type supports optional filter conditions. The filter runs before the workflow starts — unmatched events are silently skipped.

## Webhook triggers

Every workflow gets a unique webhook URL you can POST to. Use webhook triggers when something outside Tale should start the workflow — a form submission, an upstream system event, a CI/CD hook.

- The request body is available to every step as the workflow input.
- Add a webhook secret to verify request authenticity. Tale checks for an `X-Tale-Signature` header and rejects requests that don't match.
- The webhook URL is visible on the Start step and on the workflow's Configuration tab.

See [Webhooks](/develop/webhooks) for detailed request/response formats and signature verification code.

## Manual triggers

The **Run now** button on any workflow lets you start it manually with custom input. Useful for:

- Testing a new workflow before scheduling it.
- One-off runs where the workflow exists but shouldn't run automatically.
- Kicking off a backfill.

Manual runs show up in Executions like any other run.

## Multiple triggers on one workflow

A workflow can be triggered by, for example, both a schedule (every hour) and a webhook (on-demand). Each execution records which trigger started it.
