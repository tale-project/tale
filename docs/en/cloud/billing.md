---
title: Billing
description: What Tale Cloud charges for, how budgets stop runaway costs, and where the bill shows up in the product.
---

Billing on Cloud is metered, not seat-based. You pay for tokens consumed by chats and agents, voice minutes, image generations, and storage; the platform itself comes with the org. This page walks one invoice line, lists the metered components, and points at the budget controls that prevent surprises.

The invoice arrives monthly via email and is also visible inside the product under **Settings > Billing**. Cloud bills in your org's billing currency, which defaults to USD on sign-up and can be changed before the first invoice cuts.

## A worked invoice line

A line on the invoice reads `Models — Anthropic Claude Sonnet — 1.2M tokens — $4.32`. Tale assembled it from the per-message usage ledger: every chat reply records the model used, the token count, and the cost at the rate active when the call completed. Lines aggregate by provider and model per billing period. The detail is downloadable as CSV from the same screen.

## Plan tiers

Cloud ships three tiers — **Starter**, **Team**, and **Enterprise** — that differ in support SLA, audit-log retention, and access to enterprise features (SSO, DPA, region beyond the default). All tiers share the same metered pricing for tokens, voice, and storage; the tier affects fixed monthly fees and feature gates, not per-call costs.

## Metered components

| Component   | Unit              | Counted as                                                | Where to view                                                 |
| ----------- | ----------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| Models      | Tokens (in + out) | Per provider call; markup applied on top of provider rate | [Usage analytics](/platform/admin/governance/usage-analytics) |
| Voice (TTS) | Characters spoken | Per agent reply rendered as audio                         | Usage analytics                                               |
| Voice (STT) | Audio seconds     | Per user message recorded                                 | Usage analytics                                               |
| Images      | Generations       | Per image returned by the model                           | Usage analytics                                               |
| Storage     | GB-month          | Object store usage averaged over the period               | Billing page                                                  |

## Budgets and overages

Set budgets under [Policies and limits](/platform/admin/governance/policies-and-limits). A **Budget rule** caps monthly spend per user, per team, per role, or per org. Hitting a budget reads as a clear toast — **Usage limit reached** — and pauses the affected scope until the budget is raised or the period rolls over. The default precedence is `user > team > role > default` — the most specific rule wins.

A **Warning threshold (%)** on the same rule emits a notification when usage crosses the threshold without blocking. Reach for the warning when you want to know but not interrupt; reach for hard limits when overruns are an emergency.

## Where to find usage

The richest view is [Usage analytics](/platform/admin/governance/usage-analytics) under Governance — it breaks usage down by **Top Assistants**, **Top Models**, **Top Voice Models**, and **Per-User Usage**, all filterable by date range. The Billing page in Settings shows the invoice-level view; Usage analytics shows the operational view.

## Where this fits

Billing is the operator's headline page; [Usage analytics](/platform/admin/governance/usage-analytics) is the everyday one. If your org's cost is mostly tokens, the page worth bookmarking is the Top Models table — it surfaces which models the team has settled on and tells you whether a switch to a cheaper alternative would matter. For self-hosted users, the billing concept does not apply (you pay your provider directly); the cost-visibility page does.
