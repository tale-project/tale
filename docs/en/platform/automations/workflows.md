---
title: Workflows
description: The operating manual for the workflows feature — the list view, how to run a workflow, how to pause and disable, how to edit, and how the versioned history works. Read this when you are running automations day to day, not when you are learning the model.
---

Workflows is the operating manual for the feature. The mental model — what a workflow, trigger, step, and execution are — lives on [Automation concepts](/platform/automations/concepts). This page is the other half: how the list view is laid out, how you run a workflow from the UI, how you pause one without deleting it, how you edit and how the versioned history works. Editors and Developers read this when they are working with workflows day to day.

The feature is reached from **Automations** in the sidebar. The list view is the entry point; every other surface (the editor, the executions tab, the metrics dashboard) hangs off a single workflow you opened from the list.

## The list view

The list shows every workflow in the org. The toolbar carries a search box, a **Create automation** button, and an **Upload from file** menu item for importing workflow JSON. The columns are the workflow name, the description, the trigger set, the last-run timestamp, and a row action menu (rename, duplicate, delete).

The list lazily loads as you scroll. Search matches the name and the description. Click any row to open the workflow.

## Running a workflow

Three paths fire a workflow.

The **Triggers** tab on the workflow attaches the running paths: a manual trigger surfaces a button under **Automations > Manual runs** that members can click, a schedule trigger fires on a cron, a webhook trigger accepts an external POST, an event trigger subscribes to internal events. The [triggers reference](/platform/automations/triggers) covers each in depth.

The **Test automation** panel in the editor toolbar fires a one-off run from the editor. Paste the input JSON the run should receive, click **Execute**, and the run shows up in the Executions tab with its ID. Reach for the test panel when you are iterating on a workflow and want to see the full execution journal without wiring a trigger first.

While the run is live, the canvas mirrors it: every step carries a status badge — a spinner while running, a check on success, an alert on failure, a pause icon while waiting for input — and a banner above the canvas names the run being viewed. Click a badge to inspect the step's duration, error, and a preview of its output. The viewed run rides the `execution` URL parameter, so it survives a reload; dismiss the banner to clear the badges.

The test panel itself mirrors the same feed as a step list: each executed step appears with its live status, retried or looped steps carry an attempt counter, and a failed step shows its error message inline — click the step's name to jump straight to its settings. When a run fails before any step ran — it never started, timed out, or was canceled — the panel names that reason instead. Test runs also validate the input on the server against the start step's schema: a missing or mistyped field is rejected with a field-specific message before the run is even created.

The **Debug** button on the same panel starts the run in step-by-step mode. The engine pauses before every step: the paused step carries a debug badge on the canvas, and the panel shows which step is next together with the run's variables and each completed step's output, so you can check what a step is about to receive before it runs. **Step** executes the paused step and pauses again before the next one, **Continue** runs the rest of the workflow without further pauses, **Stop** cancels the run. Debug runs appear in the Executions tab with a _Paused (debug)_ badge while paused and `debug` as their trigger source.

The **Dry run** button on the same panel simulates a run without side effects — the workflow validates against the input, walks the step graph, and reports errors and warnings without calling out to any agent, API, or mail server. Reach for dry run when the workflow is not yet safe to run end to end.

## Pausing and disabling

Pausing a workflow without deleting it lives on the triggers — every trigger has an **Enabled** toggle. Switch each trigger off and the workflow stops firing; switch them back on to resume. The workflow itself stays in the list and its history stays intact.

Deleting a workflow is permanent and lives on the row action menu in the list view. Tale prompts for confirmation before the delete; the executions and the version history go with the workflow.

## Editing

Open the workflow and the editor surfaces the step graph on a canvas. Click a step to open its panel on the right; the panel carries the step's name, type, configuration, and the transitions to the next steps on success and failure. The toolbar at the top of the canvas carries **Focus** (zoom the graph), **AI assistant** (a chat that edits the workflow for you), **Test automation**, and **Add step**.

A banner above the canvas warns when the workflow has active triggers — edits to a triggered workflow take effect immediately, so a save mid-iteration can change a live run's behaviour. Pause the triggers first when the edits are not yet ready.

## Versioning and history

Every save snapshots a new version of the workflow. The **History** tab in the editor's left rail lists the versions newest first, each with a timestamp and the member who saved it. Click a row to open a diff against the current definition; click **Restore** to roll back to that snapshot. Restoring creates a new version on top of the history — the rolled-back state is the new current, and the version you replaced still sits in the list.

The history is per-workflow, not per-step. Restoring rolls the whole definition; partial restores live in the editor (copy the step config from the diff and paste it into the current version).

## Where this fits

Workflows is the operating manual; [Automation concepts](/platform/automations/concepts) is the mental model. The natural neighbours are [triggers](/platform/automations/triggers) (the kick-off), [execution logs](/platform/automations/execution-logs) (the per-run detail), [metrics](/platform/automations/metrics) (the org-wide roll-up), and [approvals in workflows](/platform/automations/approvals-in-workflows) (the human gate between steps). Reach for this page when you are working with a workflow that already exists; reach for concepts when you are building your first one.
