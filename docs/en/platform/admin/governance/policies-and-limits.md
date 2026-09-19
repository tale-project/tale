---
title: Policies and limits
description: Set spending budgets, upload rules, retention periods, feature controls, a chat confidentiality notice, and inbound-conversation routing.
---

Use **Settings > Governance > Policies & Limits** as an Admin or Owner to control resource use and data handling. Choose the section that matches the problem: spending, uploads, retention, feature availability, the notice members see in chat, or who receives inbound conversations.

<Frame caption="Governance > Policies & Limits — the budget-rules table above the upload policy and retention controls.">

![The Policies and Limits governance page showing three monthly budget rules — one for the entire organization, one default for all users, and one for the developer role, each capping tokens, cost, and requests — above the upload-policy fields for allowed file types, sizes, and volume.](/images/platform/governance-policies-limits.webp)

</Frame>

## Add a spending budget

1. Under **Budget rules**, select **Add rule**.
2. Choose the scope and its target. Use a role for a group such as Editors, a team for a shared workload, a user for an individual, an API key for one credential, or the organization for a shared ceiling.
3. Select a daily, weekly, or monthly period. Enter at least one positive token, cost, or request limit. Cost is entered in USD; an empty field leaves that dimension uncapped by this rule.
4. Optionally set **Warning threshold (%)** between 0 and 100 to warn before the cap is reached.
5. Select **Confirm**, save the pending page changes, and check the saved rule's scope, target, period, and limits.

For example, a monthly role rule can give Editors a USD 50 personal spending limit, while an organization rule caps everyone's combined spend at USD 500. These are example amounts, not recommended defaults.

Budgets apply to new billable work, including chat, voice output, and managed agent runs. Tale checks every chat request before it runs — a sent message, a regenerated or edited reply, both sides of a model comparison, a message waiting for an attachment, and a send through the REST API — and refuses it once a cap that applies is reached, naming the cap and when it resets. Replies still being written hold what they may spend, so requests sent at the same moment cannot pass a nearly reached cap together. Image generation needs cost or request limits because its usage is not measured as text tokens. Investigate warnings in [Usage analytics](/platform/admin/governance/usage-analytics).

## Understand which caps apply

Personal limits resolve each dimension from the most specific rule that defines it: user, then team, role, and default. When someone belongs to several teams with a rule, the strictest of those caps applies to them personally. Organization limits apply in addition. A team budget also caps the combined usage of the team's current members, even when a member has a more specific personal rule: a new member's usage in the current period counts at once, and someone who leaves no longer counts. API-key limits independently cap requests authenticated with that key, and those requests' usage counts toward the key; they do not cap unrelated in-app work.

Managed agent runs count against the person who started them. A run you start from a task, a comment, the REST API, or the MCP endpoint uses your personal and team caps, and a run started with an API key also counts toward that key. Runs that a schedule, a webhook, or an event started have no person behind them: only the organization's limits apply to them, and [Usage analytics](/platform/admin/governance/usage-analytics) lists them under **Automations (triggers)**.

If a request is refused unexpectedly, check all applicable caps and their periods. Increasing one personal limit does not remove an organization, shared-team, or API-key ceiling.

Members can check their own standing under [Settings > Usage](/platform/member/preferences#usage-limits). It lists each personal, team, and organization cap that applies to them with its current usage and next reset, without showing the rules themselves.

### How rules combine {#how-rules-combine}

Every policy here and under [Content & models](/platform/admin/governance/content-models) reads its rules the same way. The most specific scope wins: a user rule before a team rule, a team rule before a role rule, and a role rule before the default. When a person belongs to several teams that carry a rule, the team rules combine by what they are:

- A limit, such as a budget cap or a context-window cap, combines to the strictest value. Joining a lenient team never raises anyone's cap.
- A permission list, such as model access, combines as the union of the allowed models; a block in any of the rules still wins for that model.
- A single choice, such as the default model, follows the order of the rules in the table: the first matching team rule wins.

## Control uploads

**Upload policy** sets allowed and blocked extensions, allowed MIME types, maximum file size in MB, and total volume per user in GB. Use the types your workflows need and test an allowed file and a rejected file after saving.

A filename extension, content type, and size are separate checks. If an upload fails, compare all three with the policy. Check existing per-user storage when individual files fit but further uploads are refused.

## Set retention and recovery time

Under **Retention policy**, select **Edit** and configure the categories your organization needs. The summary shows effective values, including disabled categories and temporary-file cleanup. Disabling a category's scheduled retention does not prevent an explicit deletion or erasure request.

Check the deployment's minimum and maximum bounds before changing a period. Changes that require review or a delay appear as proposals or pending changes; read their effective time instead of assuming they apply immediately.

The deletion grace period is the recovery window for supported soft-deleted records. A positive value leaves time to restore them in [Trash](/platform/admin/governance/trash); zero permits immediate permanent cleanup. Not every category has a restore path. A [legal hold](/platform/admin/governance/legal-hold) protects covered data from cleanup.

For self-hosted deployments, [Retention configuration](/self-hosted/configuration/retention) explains the operator controls and category-specific behavior. Do not infer an archive guarantee from a disabled policy or a displayed period alone.

## Review feature controls

Feature controls include scoped context-window limits and the organization-wide voice-output switch. A context limit controls how much context can reach an AI reply; it is different from a spending budget. A limit below 200,000 tokens also applies to Claude Code agent runs, as set for the person who started the run: the agent compacts its conversation into a summary before it outgrows the limit, and Claude Code treats any limit below 100,000 tokens as 100,000. Turning off voice output prevents members from enabling it through their own defaults or conversation choices.

The custom-instructions and memories default switches store organization defaults. Their presence does not mean personal custom instructions or memory creation are currently active in chat. Organization-wide mandatory instructions are a separate setting under [Guardrails](/platform/admin/governance/guardrails).

## Show a confidentiality notice in chat

**Confidentiality notice** adds a short line under the chat message field for every member of your organization, such as a reminder not to share sensitive data. It stays off until you turn it on.

1. Turn on the **Confidentiality notice** switch. Members see the notice in chat right away, in their language; open chats update without reloading.
2. Optionally enter your own text in the language tabs **English**, **Deutsch**, and **Français**, up to 280 characters per language. Save the pending page changes.

<Frame caption="Governance > Policies & Limits — the confidentiality notice switched on, with English text, a German translation, and French still untranslated.">

![The Confidentiality notice section with its switch on and the English tab selected, asking members not to paste client names, contract values, or unreleased project codenames into chat; the Français tab is marked untranslated.](/images/platform/governance-confidentiality-notice.webp)

</Frame>

Members see the text for their language. A tab marked **untranslated** has no text of its own: members reading that language see your English text, or the default notice when English is empty too, and the empty field previews that text. A red dot marks a language whose text is too long, and saving stays unavailable until you shorten it. Turning the notice off keeps your texts for when you turn it on again.

The notice is a reminder only. It does not check, block, or change what members send. To act on sensitive content, configure [Guardrails](/platform/admin/governance/guardrails).

## Conversation routing

Use **Conversation routing** to assign new inbound conversations by the recipient address. Add a rule, select a team, a person, or both, then save it. Address matching ignores case.

A team assignment makes the conversation visible to that team's members; a person assignment makes it visible to that person. When both are set, either membership grants visibility. Unassigned conversations are for Admin and Owner triage.

Rules apply when a new conversation arrives. They do not reassign an existing conversation when a reply joins it. If a rule points to a deleted person or team, the conversation still arrives without that routing assignment. Test with a new message to the recipient address and verify the resulting assignee.

## Configure sign-in limits separately

Password requirements, sign-in attempt limits, session idle timeout, and [two-factor policy](/platform/admin/two-factor-authentication) live under **Settings > Governance > Security**. An organization idle timeout can tighten the deployment's limit. For trusted-header authentication, coordinate session expiry with the proxy or identity provider, which can authenticate the member again.
