---
title: Manage workflows
description: The operating manual for workflows — where a workflow lives, how to run one, how to pause and disable, how to edit, and how the versioned history works. Read this when you are running workflows day to day, not when you are learning the model.
---

This page is the operating manual for workflows. The mental model — what a definition, trigger, step, and execution are — lives on [Workflow concepts](/platform/workflows/concepts). This page is the other half: where a workflow lives, how you run it from the UI, how you pause one without deleting it, how you edit and how the versioned history works. Editors and Developers read this when they are working with workflows day to day.

## Where workflows live

Workflows have no standalone tab in the sidebar. A workflow belongs to the automation it powers — open the automation and its **Editor** tab is the workflow; you manage everything below from there. A direct link to a workflow keeps working when someone shares one, so bookmarks and the links on approval cards and execution views land on the workflow itself. Every surface this page covers (the editor, the executions tab, the version history) hangs off a single workflow you opened.

## Running a workflow

Three paths fire a workflow.

The **Triggers** tab on the workflow attaches the running paths: a manual trigger surfaces a run button members can click, a schedule trigger fires on a cron, a webhook trigger accepts an external POST, an event trigger subscribes to internal events. The [triggers reference](/platform/workflows/triggers) covers each in depth.

The test panel in the editor toolbar fires a one-off run from the editor. Paste the input JSON the run should receive, click **Execute**, and the run shows up in the Executions tab with its ID. Reach for the test panel when you are iterating on a workflow and want to see the full execution journal without wiring a trigger first.

While the run is live, the canvas mirrors it: every step carries a status badge — a spinner while running, a check on success, an alert on failure, a pause icon while waiting for input — and a banner above the canvas names the run being viewed. Click a badge to inspect the step's duration, error, and a preview of its output. The viewed run rides the `execution` URL parameter, so it survives a reload; dismiss the banner to clear the badges.

The test panel itself mirrors the same feed as a step list: each executed step appears with its live status, retried or looped steps carry an attempt counter, and a failed step shows its error message inline — click the step's name to jump straight to its settings. When a run fails before any step ran — it never started, timed out, or was canceled — the panel names that reason instead. Test runs also validate the input on the server against the start step's schema: a missing or mistyped field is rejected with a field-specific message before the run is even created.

The **Debug** button on the same panel starts the run in step-by-step mode. The engine pauses before every step: the paused step carries a debug badge on the canvas, and the panel shows which step is next together with the run's variables and each completed step's output, so you can check what a step is about to receive before it runs. **Step** executes the paused step and pauses again before the next one, **Continue** runs the rest of the workflow without further pauses, **Stop** cancels the run. Debug runs appear in the Executions tab with a _Paused (debug)_ badge while paused and `debug` as their trigger source.

The **Dry run** button on the same panel simulates a run without side effects — the workflow validates against the input, walks the step graph, and reports errors and warnings without calling out to any agent, API, or mail server. Reach for dry run when the workflow is not yet safe to run end to end.

## Pausing and disabling

Pausing a workflow without deleting it lives on the triggers — every trigger has an **Enabled** toggle. Switch each trigger off and the workflow stops firing; switch them back on to resume. The workflow itself stays in place and its history stays intact.

Deleting a workflow is permanent. Tale prompts for confirmation before the delete; the executions and the version history go with the workflow.

## Editing

Open the workflow and the editor surfaces the step graph on a canvas — this is the **Graph** view, one of two ways to read the same definition. Switch to **Specification** and the same workflow reads as a plain-language description you can edit directly; regenerating from either view keeps the two in sync, and a banner warns when they've drifted apart. Click a step on the graph to open its panel on the right; the panel carries the step's name, type, configuration, and the transitions to the next steps on success and failure. The toolbar at the top of the canvas carries **Focus** (zoom the graph), **AI assistant** (a chat that edits the workflow for you — the same [Automation assistant](/platform/automations/assistant) embedded here), the test panel, and **Add step**.

A banner above the canvas warns when the workflow has active triggers — edits to a triggered workflow take effect immediately, so a save mid-iteration can change a live run's behaviour. Pause the triggers first when the edits are not yet ready.

## Versioning and history

Every save snapshots a new version of the workflow. The **History** tab in the editor's left rail lists the versions newest first, each with a timestamp and the member who saved it. Click a row to open a diff against the current definition; click **Restore** to roll back to that snapshot. Restoring creates a new version on top of the history — the rolled-back state is the new current, and the version you replaced still sits in the list.

The history is per-workflow, not per-step. Restoring rolls the whole definition; partial restores live in the editor (copy the step config from the diff and paste it into the current version).

Reinstalling or updating the automation this workflow belongs to never touches these steps — a workflow is exempt from that overwrite, precisely so your edits survive a catalog update. Uninstall the automation and install it again to pick up its latest shipped workflow instead.

## Where this fits

This page is the operating manual; [Workflow concepts](/platform/workflows/concepts) is the mental model. The natural neighbours are [triggers](/platform/workflows/triggers) (the kick-off), [execution logs](/platform/workflows/execution-logs) (the per-run detail), [metrics](/platform/workflows/metrics) (the org-wide roll-up), and [approvals in workflows](/platform/workflows/approvals-in-workflows) (the human gate between steps). Reach for this page when you are working with a workflow that already exists; reach for concepts when you are building your first one.
