---
title: Usage analytics
description: Time-based analytics on token consumption, cost, and workflow performance.
---

The Usage analytics dashboard under **Settings > Governance > Usage dashboard** gives admins a time-series view of how the organisation is using Tale. It's a superset of the snapshot numbers shown in budgets — here you can see trends, drill into specific users or teams, and export data for finance or capacity planning.

## Available charts

| Chart                | Shows                                                                               |
| -------------------- | ----------------------------------------------------------------------------------- |
| **Tokens over time** | Input and output tokens per day, stacked by model.                                  |
| **Cost over time**   | Daily and monthly cost, stacked by provider.                                        |
| **Top users**        | Ranked list of users by token consumption in the selected period.                   |
| **Top teams**        | Ranked list of teams by token consumption.                                          |
| **Model mix**        | Share of requests by model — useful when rolling out new models or cost-optimising. |
| **Feature mix**      | Share of requests by feature — chat, arena, agents, automations.                    |
| **Workflow metrics** | Run count, success rate, median duration, and p95 duration per automation.          |

## Filters

Every chart respects the global filter bar:

- **Time range** — last 7 days, last 30 days, this month, last quarter, custom.
- **Team** — scope to members of selected teams.
- **User** — single-user view for individual investigations.
- **Agent** — scope to conversations and automations using a specific agent.

## Exporting

The **Export** button above any chart produces a CSV with the underlying rows, respecting all active filters. Use it for board reporting, finance reconciliation, or feeding an external BI tool.

## Retention

Analytics data follows the general [retention policy](/admin/governance). By default, detailed usage records are kept for 13 months, giving you year-over-year comparisons; aggregated monthly totals are kept indefinitely.

## Related

- [Governance](/admin/governance) — set the budgets and limits shown here.
- [Operations](/operate/observability/operations) — operator-side observability (Prometheus, logs, health).
