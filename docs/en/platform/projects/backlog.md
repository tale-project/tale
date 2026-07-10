---
title: Project Backlog
description: Backlog is a board status for proposed work — automations sync issues here, and you move tasks forward with the same drag, status picker, and assignee controls as every other lane.
---

A task at **`backlog` status** is proposed work nobody has committed to yet — most often synced in by an automation like [Triage GitHub issues](/platform/automations/builtin). It lives in the **leftmost lane** on the Board and the **top section** on the List, using the same card, detail sheet, status picker, and assignee picker as every other status. [Task automation](/platform/projects/task-automation) covers what happens once a task reaches **To do** and enters the assignment loop.

## A synced task

Triage GitHub issues proposes one task per actionable open issue, keyed to the issue so a later sync never double-creates it: the title is `#<number> <title>` — for example `#482 Login button misaligned on Safari` — the description opens with the issue's own GitHub URL, and its labels mirror the issue's GitHub labels. A task you create from the board with the default status starts at **To do**; set **Backlog** in the create form when you want to file a proposal yourself.

## Moving work forward

There are no backlog-only buttons. Drag a card to another lane, open the detail sheet and pick a new status, or assign an owner — the same paths you use for **To do** or **In progress**. Agent auto-assignment and assignment suggestions run only when a task is at **To do**, not while it sits in **Backlog**. If you move a proposal straight to **In progress** or assign it by hand, you are taking ownership yourself.

Dismiss a proposal the same way you close any task: set status to **Cancelled** in the picker. A human cancellation sticks — a later GitHub sync does not resurrect a proposal you rejected while the issue stays open on GitHub. When an issue was **Done** on the board and someone reopens it on GitHub, sync moves the task back to **Backlog**.

## Where this fits

Backlog is the intake column between an automation proposing work and your team committing to it. The natural next read is [Task automation](/platform/projects/task-automation) for what happens at **To do**, or [Built-in automations](/platform/automations/builtin) for what proposes tasks in the first place.
