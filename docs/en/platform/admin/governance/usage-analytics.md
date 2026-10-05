---
title: Usage analytics
description: Investigate token consumption, request volume, and recorded cost by model, assistant, and user.
---

Open **Settings > Metrics > Usage** as an Admin or Owner to understand which workloads consume AI resources. Start with the reporting period, then use the breakdowns to investigate a change in cost or volume.

<Frame caption="Settings > Metrics > Usage: the totals, the token chart, and the top assistants for the last 30 days.">

![The Usage metrics page for the last 30 days, reporting 14 requests, 448 tokens, a recorded cost of $0.00, and one active user, with a token chart whose only bar is the current day split into input and output, above a Top assistants table that lists the assistant and chat-title generation.](/images/platform/metrics-usage.webp)

</Frame>

## Investigate a usage increase

1. Open **Filter** and choose a **Period** of 7, 30, or 90 days. The initial view covers 30 days.
2. Compare total requests, total tokens, total cost, and active users. More requests and larger replies have different causes.
3. Choose the chart's metric and granularity in the filter menu to see when the change happened.
4. Inspect **Top assistants**, **Top models**, and **Per-user usage**. Select an assistant or model breakdown to narrow the view; remove its filter chip to return to the wider view.

Assistant names can include supporting work such as chat-title generation. A request count therefore does not always equal the number of messages members sent. Voice synthesis has its own **Top voice models** table.

**Per-user usage** attributes every request to a person: the member who sent the chat message or started the agent run, including runs started through the REST API or the MCP endpoint. Runs that a schedule, a webhook, or an event started have no person behind them. Their usage appears as one row named **Automations (triggers)**, which does not count as an active user. In **Top assistants**, a project agent and an automation each appear under their name. [How usage is counted](/platform/admin/governance/usage-attribution) explains the rule for every kind of work.

## Read cost alongside tokens

The dashboard uses recorded usage and metering information. Input and output tokens are separate, and services such as voice output or image generation may have different billing units. A token total alone cannot explain every cost. Input tokens include the part of a prompt that a provider read from or wrote to its cache. That part is priced differently from other input, so a run that reuses a long prompt can show many input tokens for a small cost.

An image an agent generated appears under its image model in **Top models** and under the agent or automation in **Top assistants**, as one request per image and without tokens. Its cost is the charge OpenRouter reported, or for OpenAI the list price of the image tokens OpenAI reported. A request the provider billed without returning a usable image counts the same way.

Treat the displayed cost as recorded application usage, not an invoice from your provider. Provider pricing, subscriptions, credits, and unmetered calls can affect how it compares with the bill. A displayed zero does not prove that a provider charged nothing.

## Respond to a budget warning

Use the same period and affected workload when investigating a budget notice. Find the user, assistant, or model behind the increase, then decide whether to change the workflow, choose another model, or adjust a cap under [Policies and limits](/platform/admin/governance/policies-and-limits).

Compare [feedback analytics](/platform/admin/governance/feedback-analytics) before making a model change solely for cost: lower spend is useful only if the results still meet the task.

## Understand missing history

Charts reflect the usage records Tale still retains. The organization and deployment retention settings determine the available history; there is no universal 365-day guarantee. Check the selected period, filters, and usage-ledger retention if expected activity is missing.

If the metrics cannot be loaded, the page says so and offers **Try again** instead of showing zeros or empty tables. The period and filters you chose stay as they are. If a refresh fails, the figures already shown stay, with a note that they may be out of date. If **Try again** keeps failing, ask the deployment operator to check that Tale's services are running.
