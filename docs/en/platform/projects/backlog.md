---
title: Project Backlog
description: The Backlog tab holds tasks an automation or a teammate proposed but nobody has vetted yet — Start moves one onto the board, Close discards it, and neither action touches the automations that fed it.
---

A project's **Backlog** tab holds every task sitting at the `backlog` status — proposed work nobody has vetted yet, most often synced in by an automation like [Triage GitHub issues](/platform/automations/builtin). This page covers the tab itself: what a backlog task looks like, the two triage actions, and how it differs from the Board and List views. [Task automation](/platform/projects/task-automation) covers what happens once a task leaves the backlog and enters the assignment loop.

## A synced task

Triage GitHub issues proposes one task per actionable open issue, keyed to the issue so a later sync never double-creates it: the title is `#<number> <title>` — for example `#482 Login button misaligned on Safari` — the description opens with the issue's own GitHub URL, and its labels mirror the issue's GitHub labels. A task you create yourself never lands here — Backlog only fills from automations and the teammates who explicitly propose work to it; a task you add from the board starts on the board.

## Start and Close

Every backlog row carries two actions. **Start** moves the task to **To do** and onto the board — from there it flows through the same [task-ops pack](/platform/projects/task-automation) as any other task, including unassigned-triage picking an agent for it if nobody claims it by hand. **Close** moves it straight to **Cancelled** without ever touching the board — the right call for a proposed task that isn't worth doing. Row click still opens the same task detail as the board and list; Start and Close are also reachable from there.

## Board and List exclude the backlog

Board and List never show a `backlog`-status task — the whole point of the tab is to keep unvetted proposals out of the views your team works from day to day. A task only appears on the board once it's Started, so a crowded Backlog never crowds the board.

## Where this fits

Backlog is the triage step between an automation proposing work and a human committing to it: Start hands a task into the same execution loop every other task uses, Close discards what isn't worth doing. The natural next read is [Task automation](/platform/projects/task-automation) for what Start actually kicks off, or [Built-in automations](/platform/automations/builtin) for what proposes tasks in the first place.
