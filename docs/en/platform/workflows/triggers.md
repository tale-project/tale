---
title: Workflow triggers
description: The four ways a workflow can start — manual, schedule, webhook, event — what each one carries into the run, and how to switch between them without rebuilding the workflow.
---

A trigger is the thing that starts a workflow. Tale ships four trigger types: manual (a button), schedule (cron-shaped), webhook (an external POST), and event (something happens inside Tale). Every workflow has at least one trigger; some have several. This page is the reference for what each trigger carries into the run, how to configure it, and how to pick between them when more than one would work.

The mental model of workflows, steps, executions, and approvals lives on [Workflow concepts](/platform/workflows/concepts). Triggers are the kick-off layer above that model; the rest of the workflow does not need to know which trigger started it, but the inputs the first step receives come from the trigger Tale just fired.

## Where triggers live

Open the workflow and switch to the **Triggers** tab. The tab lists the workflow's current triggers and lets you add new ones. A workflow with no trigger only runs from the **Run now** button in the editor — useful for testing, never for production.

A workflow can carry multiple triggers of the same type or different types. A daily-report workflow might have a schedule trigger that fires every weekday morning plus a manual trigger so a human can fire it ad-hoc; both feed into the same first step.

## The four trigger types

**Manual** is a button. Members and Editors who have access to the workflow can fire it from its run button; clicking the button opens the input form (one field per declared input) and starts the run. Reach for manual when the workflow is occasional and a human knows when it should run.

**Schedule** is cron-shaped. The trigger fires on a recurring time pattern — every weekday at 08:00, the first of every month, every 15 minutes. The schedule trigger carries no payload of its own; the first step sees only the workflow's declared inputs (typically defaulted on the trigger). Reach for schedule when the workflow recurs on a clock.

**Webhook** is an external POST. Tale mints a unique URL for the trigger; any system that POSTs to that URL fires the run. The webhook trigger carries the request's JSON body as the first step's input. Reach for webhook when an external system signals that work needs to happen — a vendor's notification, a CI job's completion, a form submission.

**Event** is an internal signal. Tale emits events when things change inside the product — a document is uploaded, an agent finishes a reply, an approval is resolved, a customer is created. The event trigger subscribes to one of those events and carries the event's payload as the first step's input. Reach for event when the workflow's job is to react to something Tale itself just did.

## A worked schedule trigger

To run a workflow every weekday at 08:00, add a Schedule trigger and pick `Every weekday at 08:00` from the picker (the picker accepts cron expressions for shapes the visual builder cannot express). The trigger's preview line shows the next three fire times — useful for sanity-checking the cron before saving.

Schedules respect the org's timezone. The configured timezone is the one the picker's hours are interpreted in; running `08:00` in `Europe/Zurich` means 08:00 local, not 08:00 UTC. The run history records the wall-clock time the run started, the timezone, and the trigger ID.

## A worked webhook trigger

To accept an external POST, add a Webhook trigger. Tale mints a URL of the shape `https://<your-tale-host>/api/automations/triggers/<id>`, generates a signing secret, and shows both in the trigger's row. Configure the calling system to POST JSON to the URL with the secret in the `X-Tale-Signature` header; the trigger verifies the signature before firing the run. A request with a bad signature returns `401` and does not fire.

The webhook trigger's payload schema is declared on the trigger — Tale validates incoming JSON against the schema before firing. A payload that fails validation returns `400` with the validation error in the body and the run does not start.

## A worked event trigger

To run a workflow whenever an `automation.approval.resolved` event lands, add an Event trigger and pick the event type from the dropdown. The trigger's payload schema is fixed by the event type — Tale shows the schema in the trigger's row. Event triggers can filter by payload fields: only fire when the approval was approved (not rejected), only fire for approvals in a specific team, and so on.

The event surface is open-ended; the list of available events grows as Tale grows. The current set covers the obvious lifecycle moments (document upload, agent reply finished, approval resolved, integration credential rotated, member added).

## Picking the right trigger

| Use … when                                       | Manual | Schedule | Webhook | Event |
| ------------------------------------------------ | ------ | -------- | ------- | ----- |
| A human knows when the work should run           | ✓      |          |         |       |
| The work recurs on a clock                       |        | ✓        |         |       |
| An external system signals the work              |        |          | ✓       |       |
| Something Tale did is the reason to run          |        |          |         | ✓     |
| You want both — recurring plus ad-hoc human runs | ✓      | ✓        |         |       |

A workflow can carry more than one trigger; the type column does not have to be one row only.

## Disabling and removing a trigger

Each trigger has an enabled toggle at the row level. Disabling a trigger stops it firing without removing it — the run history stays intact, and re-enabling restores firing immediately. Reach for disable when you want to pause a workflow temporarily; reach for delete when you are sure the trigger is retired.

## Where this fits

Triggers are the kick-off layer of the workflow model; the steps that follow them are the actual work. The natural next read is [Workflow concepts](/platform/workflows/concepts) for the workflow, step, and execution model the trigger feeds into, and [Approvals in workflows](/platform/workflows/approvals-in-workflows) for the gate that pauses the run between steps.
