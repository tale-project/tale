---
title: Policies and limits
description: Per-org caps on token cost, request count, upload size, image generation, and feature access — scoped by user, team, or role. Admins and Owners read this when a workload is over budget or when a feature needs a tighter blast radius.
---

Policies and limits is the surface where you cap what your members and agents can consume. Budgets cap tokens, cost, and requests per billing period; feature controls toggle web search, code execution, and file upload by scope; upload policy gates the file types and sizes a member can attach; retention policy decides how long each data type lives before cleanup. Admins and Owners read this page when a workload is over budget, when a feature should be off for a subset of users, or when a regulator names a retention window that differs from the default.

## A worked budget

To cap an Editor's monthly spend, open **Settings > Governance > Budgets** and click **Add rule**. Pick **Role** as the scope, **Editor** as the target, set the period to **Monthly**, and fill in a max-cost in USD. Save and the next month-period request that would push an Editor over the cap is refused with a budget-exceeded error. A warning threshold below the cap fires an alert before the cap hits. Narrower scopes override broader ones — a user rule beats a team rule beats a role rule — and org-wide limits always apply on top as an additional cap.

## The four policy layers

**Budgets** are token, cost, and request caps per scope and period. Scopes are org, role, team, or user. Each rule carries a token cap, a cost cap in USD, an optional request cap, and a warning threshold expressed as a percentage of the cap.

**Feature controls** toggle web search, code execution, and file upload per scope, and cap the max context tokens for AI replies. A feature off for a scope hides the toggle in chat and refuses the request server-side.

**Upload policy** gates the file extensions, MIME types, and sizes a member can attach. It also caps the total volume per user — useful when storage is metered. Toggle the policy off for a permissive default; toggle it on to enforce the lists.

**Retention policy** decides how long each data type (chat history, documents, prompts, audit logs, usage ledger, workflow runs, and more) stays before the cleanup pass removes it. The page shows the operator-imposed bounds, the per-org override within those bounds, and a grace window before hard delete.

## Precedence

All four layers share the same scope ladder: user > team > role > org > default. The narrowest rule wins. Where a layer carries an org-wide cap (budgets), the cap applies as an additional ceiling on top of any narrower rule.

## Retention bounds and approvals

Retention policy sits inside operator-imposed bounds — the self-hosted operator sets a floor and a ceiling per category, and the org's value clamps to that range. When the operator proposes a tighter floor or a lower ceiling, the change surfaces as a proposal Admins can apply or reject. Reductions to the policy land with a pending-change banner and a grace window before they take effect — the same grace gives Admins a chance to cancel.

## Where this fits

Policies and limits is the budget and gate layer that protects the org from runaway spend and unintended access. Pair it with [content and models](/platform/admin/governance/content-models) so the model the budget caps is also the one the access list permits, and with [retention policy on the same page](#retention-bounds-and-approvals) so the data the org keeps is bounded too. The companion is [audit logs](/platform/admin/governance/audit-logs) — every policy change here lands there as a permanent record.
