---
title: Workflow triggers
description: The three ways a workflow starts on its own — Schedules, Webhooks, and Events — what each one carries into the run, and how to pause one without deleting it.
---

A trigger is what starts a workflow without a human clicking anything. The **Triggers** tab on a workflow carries three sections — **Schedules**, **Webhooks**, and **Events** — and a workflow can hold several triggers of any mix; all of them feed the same first step. A workflow with no triggers still runs by hand from the editor's **Test workflow** panel — useful while building, never for production.

<Frame caption="The Triggers tab with the Events section expanded — one event trigger, its Active toggle, and its last-fired time.">

![The Triggers tab of an automation showing collapsed Schedules and Webhooks sections and an expanded Events section with a task.created trigger row.](/images/platform/automation-triggers.webp)

</Frame>

## Schedules

Click **Add schedule** to run the workflow on a clock. The form takes a standard 5-field cron expression, with presets from **Every 5 minutes** to **Every month** — or describe the timing in plain language and click **Generate** to let the AI write the cron for you. **Workflow variables** are the input each scheduled run receives, pre-filled from the workflow's input schema. The row shows the schedule's **Last triggered** time and who created it.

## Webhooks

Click **Add webhook** and Tale mints a unique URL; any system that POSTs JSON to it fires the run, with the request body as the run's input.

<Warning>

Save the webhook URL when it is shown — the token in the URL acts as the authentication credential. Anyone holding the URL can fire the workflow, so treat it like a secret and delete the webhook to revoke it.

</Warning>

## Events

Click **Add event trigger** and pick an event type from the dropdown — things that happen inside Tale, such as `task.created`, `conversation.message_received`, `customer.updated`, or `workflow.completed`. Optional filters narrow when the trigger fires, and the event's payload becomes the run's input. Reach for an event trigger when the workflow's job is to react to something Tale itself just did.

<Note>

A workflow that belongs to an [automation](/platform/automations/concepts) runs only from within its automation — it can't subscribe to events itself.

</Note>

## Picking the right trigger

| Use … when                              | Schedule | Webhook | Event |
| --------------------------------------- | -------- | ------- | ----- |
| The work recurs on a clock              | ✓        |         |       |
| An external system signals the work     |          | ✓       |       |
| Something Tale did is the reason to run |          |         | ✓     |

A workflow can carry more than one — a daily schedule plus a webhook for ad-hoc external kicks is a common pair.

## Pausing and removing

Every trigger row has an **Active** toggle. Switching it off stops the firing without losing the row or the run history; switching it back on resumes immediately. Deleting the row is permanent — for webhooks it also kills the URL, so any system still POSTing to it stops working.

## Where this fits

Triggers are the kick-off layer; the steps after them are the actual work. Head to [Automation concepts](/platform/automations/concepts) for the model a trigger feeds into, and to [Execution logs](/platform/automations/execution-logs) to see what each fired run recorded — including which trigger started it.
