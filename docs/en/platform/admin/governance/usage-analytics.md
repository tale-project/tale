---
title: Usage analytics
description: The dashboard for tokens, cost, and request volume by user, team, model, and agent — with trends and a top-agent leaderboard. Admins and Owners read this when a bill is unexpected or when leadership wants the rough shape of AI spend.
---

Usage analytics is the dashboard that aggregates every billable AI call into a single view of tokens, cost, and request volume. It slices by user, team, role, model, agent, and time so the unexpected line on the bill is traceable to the workload that drove it. Admins and Owners read this page when a bill is unexpected, when leadership wants the rough shape of AI spend, or when a budget alert fires and the next question is _who and what_.

## A worked drill-down

Open **Settings > Governance > Usage**. The default view is the last 30 days, org-wide, with the three headline counters — total tokens, total cost in USD, total requests. Switch the breakdown to **By user** to find the heaviest consumers, **By model** to compare an expensive primary against a cheaper fallback, or **By agent** to find the agent driving the load. Each row clicks through to a per-row time series; the chart axis follows the chosen period.

## The dimensions

- **User** — every member who has triggered a billable call. Pair with the team or role filter to scope the view.
- **Team** — aggregated across team members; useful when budgets are team-scoped.
- **Role** — Owner, Admin, Developer, Editor, Member.
- **Model** — every model that produced a reply, grouped by provider.
- **Agent** — every named agent (the leaderboard sorts by token volume, cost, or request count).
- **Time** — daily trend for short windows, weekly for longer windows.

## The cost model

Cost is an estimate. Each request lands in the usage ledger with input tokens, output tokens, the model's published price per million tokens, and the wall-clock duration. The dashboard multiplies tokens by price; image generation calls land with a per-image cost the provider returns. The ledger row is the source of truth, and the [audit log](/platform/admin/governance/audit-logs) carries the row's actor and timestamp for cross-reference.

## Budget overlays

When [policies and limits](/platform/admin/governance/policies-and-limits) has a budget for a scope, the usage chart overlays the cap as a horizontal line. Hovering a point shows the percentage of the cap consumed and the projected month-end based on the current trend. Crossing the warning threshold paints the chart's series amber; crossing the cap paints it red and surfaces the budget-exceeded events as markers on the time axis.

## Retention of usage rows

The usage ledger has its own retention window in [policies and limits](/platform/admin/governance/policies-and-limits). Default is 365 days; shorten it and the historical chart truncates accordingly. The dashboard reflects whatever the ledger holds — there is no archive layer underneath.

## Where this fits

Usage analytics is the spend and volume side of the same workload [feedback analytics](/platform/admin/governance/feedback-analytics) reads for quality. Together they answer _is this agent worth its cost_. The companion is [policies and limits](/platform/admin/governance/policies-and-limits) — the page where the budgets this dashboard overlays are configured.
