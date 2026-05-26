---
title: Automations
description: Build, configure, and test automations in the visual editor.
---

The automation editor is where the vocabulary from [Automation concepts](/platform/automations/concepts) becomes a runnable graph. This page covers the build flow itself: opening the editor, the six step types, the configuration knobs that shape retries and timeouts, the variables every step can read, and the **Test automation** path that proves a draft before it goes live. The audience is the Developer or higher who is building or maintaining an automation; the trigger and execution surfaces have their own pages, linked at the bottom.

## Open the editor

Open **Automations** in the sidebar and click **Create automation**. The dialog has two tabs: **Blank** lets you describe what the automation should do in a single field, and the AI assistant turns that description into a first draft of steps you can refine in the editor. **From template** lists the ready-made automations bundled with installed integrations — pick one, give it a name, and the editor opens with the template's steps already wired up.

The editor itself is a canvas. Steps are nodes, links between them are directional, and the panel on the right opens whatever step is currently selected. The toolbar at the top of the canvas carries **Add step**, **Test automation**, **AI assistant**, and **Focus** (collapse the canvas to a single column for a smaller screen).

## Step types

Six step types cover the work an automation can do. Pick by what the step has to accomplish.

| Step          | Use it for                                                               |
| ------------- | ------------------------------------------------------------------------ |
| **Start**     | The entry point. Names the input schema and binds the triggers.          |
| **Action**    | Calling an integration operation, an MCP tool, or a Tale-native action.  |
| **LLM**       | Sending a prompt to a model and routing the reply forward.               |
| **Condition** | Branching to one of several paths based on a check on prior step output. |
| **Loop**      | Repeating a block of steps once per item in a list.                      |
| **Output**    | Naming the data the automation returns when it finishes.                 |

Every step lands on the canvas with sensible defaults; you configure it by clicking it and editing in the right-hand panel. The panel validates as you type and flags missing fields with an inline error rather than letting the automation save in a broken state.

## Configuration

Open the **Configuration** tab of any automation to set the knobs that apply to the whole run rather than to one step.

| Field            | Default     | What it does                                                                               |
| ---------------- | ----------- | ------------------------------------------------------------------------------------------ |
| **Name**         | —           | The name shown everywhere in the platform. Required.                                       |
| **Description**  | —           | Free-text description, surfaced in pickers and metrics.                                    |
| **Timeout (ms)** | 300,000     | How long the whole automation may run before the engine stops it. Default is five minutes. |
| **Max retries**  | 3           | Per-step retry count when a step fails with a transient error.                             |
| **Backoff (ms)** | 1,000       | Delay between retry attempts. Doubles per attempt up to a sensible cap.                    |
| **Variables**    | `{}` (JSON) | Shared key-value bag read by every step as `{{ variables.<key> }}`. Edit as a JSON object. |

The **Save configuration** button writes the change. Saved changes apply to the next run — in-flight runs keep the configuration they started with.

## Variables

The **Variables** field is a JSON object. Anything you put there is readable from every step config with the `{{ variables.<key> }}` syntax. The two common shapes are credentials referenced by multiple steps and feature flags that change behaviour between drafts and the live version. Two notes worth remembering: secret values stored as variables are not separately encrypted — for credentials a connector reads, use the integration's credential surface instead; and variables are versioned with the rest of the automation, so a restore from **History** restores them along with the steps.

## Test automation

Click **Test automation** in the toolbar to run the draft with an input payload of your choice. The test runs against the same engine as production runs but is recorded on the **Executions** tab with the trigger source labelled `manual`, so you can replay it, diff its output against a previous run, and reuse its input later. Use it before publishing — a published draft starts firing on its real triggers immediately, and a five-second test catch beats a 3 am pager about a misconfigured **Action** step.

## History

Every saved edit lands in **History**, alongside the editor's main canvas. The **Restore** button rolls the automation back to the snapshot you pick; the **Compare changes** view shows the diff before you commit to the restore. History is the safety net for "the change I shipped this morning broke the nightly run" — open it, find the previous snapshot, restore.

## Build one

The editor is opinionated by design: each step does one move, the graph runs from **Start** to **Output**, and **Test automation** proves the shape before publishing. The next two pages cover the parts of the model the editor only points at — [Triggers](/platform/automations/triggers) for the four ways an automation starts, and [Execution logs](/platform/automations/execution-logs) for the per-run trace you read when something fails.
