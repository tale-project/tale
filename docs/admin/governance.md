---
title: Governance
description: Organisation-wide AI policies, limits, security controls, and audit logs.
---

Governance is where admins set the rules for how AI is used across the organisation. It's organised into three groups accessible from the left-hand navigation under **Settings > Governance**, plus an audit log page for compliance.

## Content & models

### System prompt

Set a global system prompt that is prepended to every AI conversation in the organisation. Use it to enforce tone, scope, and safety rules that every agent inherits.

### Default models

Choose the default chat, vision, and embedding models used when users don't pick one explicitly. Models come from any configured provider — see [AI providers](/admin/providers).

### Model access

Control which models are available to specific teams or users. Restrict expensive frontier models to senior staff, or expose only self-hosted models to a particular team.

## Policies & limits

### Budgets

Set spending limits per user, per team, or for the whole organisation. Configure the period (daily, weekly, monthly) and the action to take when the limit is hit — warn, block new requests, or disable chat entirely.

### Upload policy

Restrict file uploads by type, size, or count. Useful when you want to prevent large binary uploads or block executable file types.

### Retention

Configure how long conversations, uploaded files, and audit records are kept before automatic deletion. See [Retention](/operate/configuration/retention) for the matching environment-level defaults that apply to self-hosted deployments.

### Feature controls

Toggle platform features on or off organisation-wide: file uploads, web search, image generation, arena mode, and more. Features disabled here are hidden from the UI for all users.

## Security & monitoring

### PII detection

Enable automatic detection and masking (or blocking) of personally identifiable information in messages. Supports built-in patterns (email, phone, credit-card numbers) and custom regex rules. Blocked messages never reach the model.

### Usage dashboard

View token consumption, cost breakdowns, and usage trends across the organisation. Filter by team, user, model, or time period. For deeper analytics see [Usage analytics](/admin/usage-analytics).

## Audit logs

A time-ordered record of significant actions taken in the organisation. Categories include authentication events, member changes, data operations, integration updates, workflow publications, security events, and admin actions. Useful for compliance and troubleshooting.

Admins can export audit logs as **CSV** or **JSON** using the export buttons above the log table. Exports respect the currently active category filter.
