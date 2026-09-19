---
title: Usage analytics
description: Investigate token consumption, request volume, and recorded cost by model, assistant, and user.
---

Open **Settings > Metrics > Usage** as an Admin or Owner to understand which workloads consume AI resources. Start with the reporting period, then use the breakdowns to investigate a change in cost or volume.

## Investigate a usage increase

1. Open **Filter** and choose a **Period** of 7, 30, or 90 days. The initial view covers 30 days.
2. Compare total requests, total tokens, total cost, and active users. More requests and larger replies have different causes.
3. Choose the chart's metric and granularity in the filter menu to see when the change happened.
4. Inspect **Top assistants**, **Top models**, and **Per-user usage**. Select an assistant or model breakdown to narrow the view; remove its filter chip to return to the wider view.

Assistant names can include supporting work such as chat-title generation. A request count therefore does not always equal the number of messages members sent. Voice synthesis has its own **Top voice models** table.

**Per-user usage** attributes every request to a person: the member who sent the chat message or started the agent run, including runs started through the REST API or the MCP endpoint. Runs that a schedule, a webhook, or an event started have no person behind them. Their usage appears as one row named **Automations (triggers)**, which does not count as an active user. In **Top assistants**, a project agent and an automation each appear under their name. [How usage is counted](/platform/admin/governance/usage-attribution) explains the rule for every kind of work.

## Read cost alongside tokens

The dashboard uses recorded usage and metering information. Input and output tokens are separate, and services such as voice or image generation may have different billing units. A token total alone cannot explain every cost.

Treat the displayed cost as recorded application usage, not an invoice from your provider. Provider pricing, subscriptions, credits, and unmetered calls can affect how it compares with the bill. A displayed zero does not prove that a provider charged nothing.

## Respond to a budget warning

Use the same period and affected workload when investigating a budget notice. Find the user, assistant, or model behind the increase, then decide whether to change the workflow, choose another model, or adjust a cap under [Policies and limits](/platform/admin/governance/policies-and-limits).

Compare [feedback analytics](/platform/admin/governance/feedback-analytics) before making a model change solely for cost: lower spend is useful only if the results still meet the task.

## Understand missing history

Charts reflect the usage records Tale still retains. The organization and deployment retention settings determine the available history; there is no universal 365-day guarantee. Check the selected period, filters, and usage-ledger retention if expected activity is missing.
