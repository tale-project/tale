---
title: Plans, invoices, and usage
description: Understand your Cloud service charges, model usage, and the controls available in Tale.
---

Your Cloud service agreement determines what you pay for hosting, support, seats, and storage. Model usage is a separate consideration: the provider and model you use affect the cost of each AI request.

## Understand the charges

Tale offers the free, self-hosted Community edition and Enterprise for managed Cloud or supported self-hosted deployments. Both include the same product features. Enterprise adds professional services and support; it does not unlock a separate set of product controls.

The [pricing page](https://tale.dev/pricing) is the source for current seat and storage rates, billing periods, and included services. It lists AI usage at provider rates without a markup. Use your agreed quote and service agreement for the terms that apply to your organization.

## Find an invoice or change billing details

Contact the Tale team through your Enterprise support channel for invoices, billing details, seat changes, or questions about a charge. There is no **Settings > Billing** page in the shared product interface. Usage dashboards are operational records, not an invoice portal.

When querying a charge, include the billing period, organization, and invoice reference. Never include provider keys or API keys.

## Understand model usage

Open [Usage analytics](/platform/admin/governance/usage-analytics) to see the usage recorded by the platform. Use the date range and model or user breakdowns to find what generated the activity.

A displayed usage cost and a final invoice serve different purposes. Your commercial agreement and the provider’s billing rules determine the amount payable; do not treat a dashboard total as a final invoice or tax statement.

<Tip>

Before rolling out a new model, try a representative task and review its quality and recorded usage. A cheaper request is useful only if it produces a result your team can use.

</Tip>

## Set limits for the workspace

Use [Policies and limits](/platform/admin/governance/policies-and-limits) to configure the controls your team needs. Check the scope of each rule and test it with an account in that scope. Platform limits apply to the activity they govern; they do not change the terms of your hosting contract.

For self-hosted Community, you operate the infrastructure and pay your chosen providers directly. The same usage and policy pages help you understand that activity.
