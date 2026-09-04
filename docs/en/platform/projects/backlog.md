---
title: Project Backlog
description: Backlog is the board's intake status for work nobody has committed to yet — how a task lands there and how you move it forward with the same controls as every other column.
---

A task at **Backlog** is proposed work nobody has committed to yet. It sits in the leftmost lane of the Board and the top section of the List, with the same card, detail sheet, status picker, and assignee picker as every other status — there are no backlog-only controls. Nothing shipped fills the lane on its own in this version: [Triage GitHub issues](/platform/automations/builtin) scores issues and returns a report, and no automation syncs issues into tasks. Backlog fills when a person or an agent files a proposal.

## How a task lands in Backlog

Create a task and pick **Backlog** in the create form's status picker — the form defaults to **To do**. An agent can file one too: a project agent equipped with the create-tasks tool may create into **Backlog** or **To do** and nowhere else, so a proposal an agent makes never lands in a working or terminal column. The same rule holds for an automation that runs with a project's task tools.

## Moving work forward

Drag the card to another lane, open the detail sheet and pick a new status, or assign an owner — the same paths you use for **To do** or **In progress**. Assignment is allowed while a task sits in Backlog, so you can hand a proposal to a person or a project agent before it moves; assigning a project agent and clicking **Start agent** puts it to work, and [Task automation](/platform/projects/task-automation) covers what happens from there. Dismiss a proposal the way you close any task: set its status to **Cancelled**.

## Where this fits

Backlog is the intake column between a proposal — yours, a teammate's, or an agent's — and the team committing to it. [Task automation](/platform/projects/task-automation) is the next read for the loop a task enters once it is assigned; [Built-in automations](/platform/automations/builtin) explains why the shipped GitHub pack reports instead of filing tasks.
