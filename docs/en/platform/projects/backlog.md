---
title: Triage the project backlog
description: Capture proposed work, decide what is ready, and move it into delivery without confusing assignment with execution.
---

Use **Backlog** for proposed work the team has not committed to yet. It is a normal task status, shown first in the board and list. A proposal can already have an assignee; assignment alone does not make it active work. A proposal assigned to you still appears among your tasks in [Home](/platform#home), marked **Backlog**.

## Capture a proposal

Open the project’s **Tasks** and create a task. Choose **Backlog** in the status picker; new tasks otherwise default to **To do**. Give the proposal a title describing the outcome and enough context for someone to decide whether to pursue it.

For example, “Check the mobile checkout error” is easier to triage with the affected page, a reproducible symptom and a screenshot than with a title alone. Leave implementation detail open until the problem is understood.

A project agent with the task-creation tool can also create a proposal. That tool allows initial **Backlog** or **To do** status, not a working or finished status. The same boundary applies when an automation uses the project’s task tools.

## Decide what happens next

| Decision | Action |
| --- | --- |
| More information is needed | Keep **Backlog** and explain the missing information in the description or a comment. |
| The team accepts the work | Set **To do** and choose an assignee. |
| Work has started | Move to **In progress**. |
| The proposal will not be pursued | Set **Cancelled**, preserving the task’s discussion. |

Change status in the task detail or drag the card between board columns. These are the same controls used for other tasks; Backlog has no separate accept or reject workflow.

## Hand the task to an agent

Choose an agent from the same project and make the expected result explicit before clicking **Start agent**. Assigning it does not replace that start action. Use [Task automation](/platform/projects/task-automation) for prerequisites, progress and review.

## Understand where proposals come from

The shipped **Triage GitHub issues** automation returns a ranked report. It does not create project tasks or fill Backlog automatically. A person or an appropriately equipped agent must turn a selected issue into a task. This keeps the decision to accept work separate from the report that recommends it.

[Manage project tasks](/platform/projects/tasks) covers task details, comments, dependencies and the rest of the board.
