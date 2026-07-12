---
title: Workflow triggers
description: The three ways a workflow starts on its own — Schedules, Webhooks, and Events — what each one carries into the run, and how to pause one without deleting it.
---

A trigger is what starts a workflow without a human clicking anything. The **Triggers** tab on a workflow carries three sections — **Schedules**, **Webhooks**, and **Events** — and a workflow can hold several triggers of any mix; all of them feed the same first step. A workflow with no triggers still runs by hand from the editor's **Test workflow** panel — useful while building, never for production.

<Frame caption="The Triggers tab with the Events section expanded — one event trigger, its Active toggle, and its last-fired time.">

![The Triggers tab of an automation showing collapsed Schedules and Webhooks sections and an expanded Events section with a task.created trigger row.](/images/platform/automation-triggers.webp)

</Frame>

## Schedules

Click **Add schedule** to run the workflow on a clock. The form takes a standard 5-field cron expression, with presets from **Every 5 minutes** to **Every month** — or describe the timing in plain language and click **Generate** to let the AI write the cron for you. **Timezone** picks which zone the cron fires in, defaulting to your own browser's zone; editing an existing schedule keeps whatever zone it already runs on.

**Workflow variables** are the input each scheduled run receives — and when the workflow's start step declares an input schema, the dialog renders it as a real form instead of raw JSON: a `projectId` field becomes a **Project** select defaulting to this schedule's own bound project, `owner` and `repo` together collapse into one **GitHub repository** field that takes `owner/repo` or a full GitHub URL, and every other declared field gets its own labelled input with the schema's own description as help text. A required field left blank shows its own error and blocks **Save** — the same rule the workflow editor's **Test workflow** panel already enforces, so a schedule can't be saved in a shape its own workflow would reject at run time. Click **Edit as JSON** to fall back to the raw editor for a schema the form can't represent.

These variables are per-schedule, not the automation's workflow defaults shown on its **Configuration** tab — two different schedules on the same workflow can each send their own repository or project, and only what's set here reaches the run.

The row shows the schedule's bound **Project** (or **No project**), its **Last triggered** time, and who created it. A schedule still missing one of its workflow's required variables carries a yellow **Needs configuration** badge — hover it for the exact field names — even while active, since a fire-time run with a blank required value fails; a schedule bound to a project already satisfies a required `projectId` without repeating it in the variables. The same gap surfaces on the automation's own **Finish setup** banner and on the [install wizard](/platform/automations/catalog)'s Done step, both linking back here to fix it.

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
