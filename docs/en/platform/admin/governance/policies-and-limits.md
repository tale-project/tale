---
title: Policies and limits
description: Per-org caps on token cost, request count, upload size, image generation, and feature access — scoped by user, team, role, or individual API key. Admins and Owners read this when a workload is over budget or when a feature needs a tighter blast radius.
---

Policies and limits is the surface where you cap what your members and agents can consume. Budgets cap tokens, cost, and requests per billing period; feature controls toggle web search, code execution, and file upload by scope; upload policy gates the file types and sizes a member can attach; retention policy decides how long each data type lives before cleanup. Admins and Owners read this page when a workload is over budget, when a feature should be off for a subset of users, or when a regulator names a retention window that differs from the default.

<Frame caption="Governance > Policies & Limits — the budget-rules table above the upload policy and retention controls.">

![The Policies and Limits governance page showing three monthly budget rules — one for the entire organization, one default for all users, and one for the developer role, each capping tokens, cost, and requests — above the upload-policy fields for allowed file types, sizes, and volume.](/images/platform/governance-policies-limits.webp)

</Frame>

## A worked budget

To cap an Editor's monthly spend, open **Settings > Governance > Budgets** and click **Add rule**. Pick **Role** as the scope, **Editor** as the target, set the period to **Monthly**, and fill in a max-cost in USD. Save and the next month-period request that would push an Editor over the cap is refused with a budget-exceeded error. A warning threshold below the cap fires an alert before the cap hits. Narrower scopes override broader ones — a user rule beats a team rule beats a role rule — and org-wide limits always apply on top as an additional cap.

## The four policy layers

**Budgets** are token, cost, and request caps per scope and period. Scopes are org, role, team, user, or API key. Each rule carries a token cap, a cost cap in USD, an optional request cap, and a warning threshold expressed as a percentage of the cap. An API-key rule targets one issued key (pick **API key** as the scope, then the key from **Settings > API**) and caps only the traffic authenticated with that key — the REST and OpenAI-compatible API — so you can meter a single connector without touching in-app usage. Image generation is metered by cost and request count, not tokens — an image request reports no tokens, so cap image spend with the cost or request limit, not the token limit.

**Feature controls** toggle web search, code execution, and file upload per scope, and cap the max context tokens for AI replies. A feature off for a scope hides the toggle in chat and refuses the request server-side.

**Upload policy** gates the file extensions, MIME types, and sizes a member can attach. It also caps the total volume per user — useful when storage is metered. Toggle the policy off for a permissive default; toggle it on to enforce the lists.

**Retention policy** decides how long each data type (chat history, documents, prompts, audit logs, usage ledger, workflow runs, and more) stays before the cleanup pass removes it. The page shows the operator-imposed bounds, the per-org override within those bounds, and a grace window before hard delete.

## Precedence

All four layers share the same scope ladder: user > team > role > org > default. The narrowest rule wins. Where a layer carries an org-wide cap (budgets), the cap applies as an additional ceiling on top of any narrower rule. An API-key budget sits outside the ladder as its own independent bucket: it binds the key's own requests regardless of the owner's user, team, or org caps, so a single credential can be held to a tighter allotment than the person who issued it.

## Retention bounds and approvals

Retention policy sits inside operator-imposed bounds — the self-hosted operator sets a floor and a ceiling per category, and the org's value clamps to that range. When the operator proposes a tighter floor or a lower ceiling, the change surfaces as a proposal Admins can apply or reject. Reductions to the policy land with a pending-change banner and a grace window before they take effect — the same grace gives Admins a chance to cancel.

## Session idle timeout

Session idle timeout signs members out after a period of inactivity — the session-bound control compliance frameworks ask for (SOC 2 CC6.1). Open **Settings > Governance > Security & Monitoring**, switch on **Enable session idle timeout**, and set **Idle timeout (minutes)** (1–1440, default 30). Members see a warning shortly before the cut-off; after it, the active tab signs out and the login page explains the sign-out instead of presenting a bare form.

The window can only tighten the deployment-wide limit, never loosen it. Self-hosted operators set that hard cap with an environment variable (see the [environment reference](/self-hosted/configuration/environment-reference)); the org policy applies on top, and the stricter of the two windows wins. A member of several organisations gets the strictest window across all of them.

Enforcement has two halves. The watchdog in the browser ends open, visible sessions on the minute. Closed tabs and abandoned devices are caught server-side by a revocation sweep that runs about every five minutes — a session can therefore outlive the window by a few minutes; when you state the control to an auditor, count the window plus roughly half an hour in the worst case. Every server-side revocation lands in the [audit log](/platform/admin/governance/audit-logs) as `session.idle_revoked`. One caveat for trusted-headers deployments: the reverse proxy owns authentication there, so a revoked session is re-established as soon as the member confirms the sign-in notice — pair the policy with an idle timeout on the proxy or IdP side for a real lockout.

## Conversation assignee control

By default every member with inbox access sees every conversation in the organization. Under **Settings > Governance > Policies & limits**, open **Conversation assignee control** and turn on **Enabled for this organization** to make an assigned conversation private: one assigned to a team is visible only to that team's members, and one assigned to a person only to that person. Unassigned conversations stay a shared org-wide pool anyone can pick up, and admins and owners always see everything.

The switch is off for existing organizations, so nothing changes until an admin turns it on. Visibility follows the [team](/platform/admin/teams) and the member a conversation is assigned to — both set from the assignee picker in the conversation header.

## Conversation routing

Inbound mail lands unassigned unless a routing rule claims it. Under **Settings > Governance > Policies & limits**, open **Conversation routing** and add a rule mapping a recipient address to a team, a person, or both: the next conversation that arrives at that address is assigned the moment it is created, before anyone opens the inbox. A rule matches the address the sender wrote to — the conversation's `To` — case-insensitively; an address with no rule stays unassigned in the shared pool.

Routing only ever assigns; it never reassigns a conversation that already has an owner or team, so a reply threading into an existing thread is left alone. Pair it with **Conversation assignee control** above to make routed mail private to the team it lands in the instant it arrives. A rule pointing at a since-deleted team or person is skipped — the conversation still arrives, just unassigned.

## Where this fits

Policies and limits is the budget and gate layer that protects the org from runaway spend and unintended access. Pair it with [content and models](/platform/admin/governance/content-models) so the model the budget caps is also the one the access list permits, and with [retention policy on the same page](#retention-bounds-and-approvals) so the data the org keeps is bounded too. The companion is [audit logs](/platform/admin/governance/audit-logs) — every policy change here lands there as a permanent record.
