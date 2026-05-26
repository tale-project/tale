---
title: Usage analytics
description: Time-series view of token consumption, cost, and workflow performance — filtered by team, user, agent, and time range, with CSV export for finance and capacity planning.
---

Usage analytics is the dashboard Admins consult when the question is "how much is the organisation spending, on which models, for which work?". It is a superset of the snapshot numbers the budgets surface shows: budgets answer "are we over the cap right now", and this page answers "what is the trend, who is driving it, and which workflow is responsible". The surface is **Settings > Governance > Usage dashboard**, and it is Admin-only.

The audience is the Admin doing finance reconciliation, capacity planning, or a post-incident usage review. For the operator-side observability stack (Prometheus, logs, health checks), [Operations](/self-hosted/operate/observability/operations) is the page; this one stays inside the product.

## Available charts

| Chart                | What it shows                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| **Tokens over time** | Input and output tokens per day, stacked by model.                                                    |
| **Cost over time**   | Daily and monthly cost, stacked by provider.                                                          |
| **Top users**        | Ranked users by token consumption in the selected period.                                             |
| **Top teams**        | Ranked teams by token consumption in the selected period.                                             |
| **Model mix**        | Share of requests by model — useful when rolling out a new model or running a cost-optimisation pass. |
| **Feature mix**      | Share of requests by feature — chat, arena, agents, automations.                                      |
| **Workflow metrics** | Per-automation run count, success rate, median duration, and p95 duration.                            |

Every chart respects the global filter bar so a single filter change refreshes the whole dashboard.

## Filters

The filter bar at the top of the page exposes four scopes:

- **Time range** — last 7 days, last 30 days, this month, last quarter, or a custom range.
- **Team** — scope to members of the selected teams.
- **User** — a single-user view for individual investigations.
- **Agent** — scope to conversations and automations using a specific agent.

Filters compose: pick **Team = Support** and **Agent = Customer support** to see token spend for one agent within one team. The active filter set is included in every CSV export, so a downstream spreadsheet keeps the scope visible.

## Exporting

The **Export** button above any chart produces a CSV of the underlying rows, respecting every active filter. Use it for board reporting, finance reconciliation, or feeding an external BI tool — the rows match the chart's data points one-to-one, so the spreadsheet line items reconcile with the dashboard.

## Capped windows

When a filter window contains more than 5,000 runs, the dashboard surfaces a banner stating it is showing the most recent 5,000 runs in this window. Older runs in the same period are excluded from the totals. Narrow the window — pick a tighter time range or a more specific team or agent — to see complete numbers for the period that fits inside the cap.

## Retention

Usage analytics rows follow the **Usage ledger** retention setting under [Governance > Retention](/platform/admin/governance#retention). By default, detailed usage records are kept long enough for year-over-year comparisons; aggregated monthly totals stay indefinitely. Shortening the usage-ledger retention truncates the historical analytics this page draws on, which is why the retention form surfaces a warning before a reduction is saved.

## Where this fits

Usage analytics is the time-series view of consumption — tokens, cost, runs, by user and team. It pairs with [Governance](/platform/admin/governance), where the budgets and limits the dashboard is measuring against are set, and with [Operations](/self-hosted/operate/observability/operations) for the operator-side observability stack. When a chart trends the wrong way, the action goes back to Governance to tighten the policy — adjust a budget, restrict a model, narrow a default — and this page is where you verify the change took effect on the next refresh.
