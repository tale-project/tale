---
title: Usage analytics
description: The dashboard for tokens, cost, and request volume by user, team, model, and agent — with trends and a top-agent leaderboard. Admins and Owners read this when a bill is unexpected or when leadership wants the rough shape of AI spend.
---

Usage analytics is the dashboard that aggregates every billable AI call into a single view of tokens, cost, and request volume. It slices by user, team, role, model, agent, and time so the unexpected line on the bill is traceable to the workload that drove it. Admins and Owners read this page when a bill is unexpected, when leadership wants the rough shape of AI spend, or when a budget alert fires and the next question is _who and what_.

## A worked drill-down

Open **Settings > Metrics > Usage**. The default view is the last 30 days, org-wide, with the headline counters — total requests, total tokens, total cost, and active users — above the usage trend. Read **Per-user usage** to find the heaviest consumers, **Top models** to compare an expensive primary against a cheaper fallback, or **Top assistants** to find the assistant driving the load. The period switch (7, 30, or 90 days) drives every section at once.

## The dimensions

- **User** — every member who has triggered a billable call, with their tokens, cost, and requests.
- **Model** — every model that produced a reply; voice models keep their own leaderboard.
- **Assistant** — every assistant with attributed usage.
- **Time** — the trend chart follows the chosen window: 7, 30, or 90 days.

## The cost model

Cost is an estimate. Each request lands in the usage ledger with input tokens, output tokens, the model's published price per million tokens, and the wall-clock duration. The dashboard multiplies tokens by price; image generation calls land with a per-image cost the provider returns. The ledger row is the source of truth, and the [audit log](/platform/admin/governance/audit-logs) carries the row's actor and timestamp for cross-reference.

## Budgets and usage

Budgets live on [policies and limits](/platform/admin/governance/policies-and-limits); this dashboard is where you trace what drove them. When a budget warning or a budget-exceeded notice fires in chat, the per-user and per-model tables here answer the follow-up — who spent it, on which model, over which days.

## Retention of usage rows

The usage ledger has its own retention window in [policies and limits](/platform/admin/governance/policies-and-limits). Default is 365 days; shorten it and the historical chart truncates accordingly. The dashboard reflects whatever the ledger holds — there is no archive layer underneath.

## Where this fits

Usage analytics is the spend and volume side of the same workload [feedback analytics](/platform/admin/governance/feedback-analytics) reads for quality. Together they answer _is this agent worth its cost_. The companion is [policies and limits](/platform/admin/governance/policies-and-limits) — the page where the budgets this dashboard overlays are configured.
