---
title: Workforce metrics
description: How agent work is measured — the workforce dashboard, per-agent scorecards, and per-project metrics, always pairing outcomes with intervention and cost.
---

Tale measures the AI workforce the way you would measure a team: **outcome, human intervention, and cost — always together**. A cheap agent whose work always bounces back is not cheap.

## The workforce dashboard

**Agents → Workforce** is the operational home: the task-automation master toggle, a health strip (24h runs, failures, automation errors, oldest queued run), paired KPI cards, a daily activity trend, the agent leaderboard, and four needs-attention queues — pending reviews, stale agent work, queued runs, and circuit-breaker pauses — each deep-linking into the board.

The KPIs:

- **Completed** — tasks finished in the window, split agent vs human.
- **Intervention rate** — changes-requested plus escalations per agent run, with the first-pass review approval rate.
- **Cycle time** — first _In progress_ to _Done_.
- **Spend** — with cost per completed task, never alone.

## Agent scorecards

Each agent's **Performance** tab shows its 30-day scorecard — completions, first-pass approval rate with changes/escalations, average run time, spend — plus its most recent runs with status, trigger, duration, and cost.

## Project metrics

Every board has a **Metrics** view: cumulative flow from end-of-day snapshots, created-vs-completed throughput, cycle-time trend, the agent-vs-human completion split, and spend.

## Where the numbers come from

A nightly rollup aggregates per-project and per-day from the task activity timeline and the unified run records (internal **and** external runs share one record). Sums and counts are stored — re-aggregation stays exact. Numbers that hit a scan cap are flagged as lower bounds. Daily digests (and a Monday weekly summary) deliver the headline numbers to org admins' inboxes — silent on quiet days.
