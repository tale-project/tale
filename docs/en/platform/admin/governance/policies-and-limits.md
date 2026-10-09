---
title: Policies and limits
description: Set spending budgets, upload rules, retention periods, feature controls, a chat confidentiality notice, who may share skills with everyone, and inbound-conversation routing.
---

Use **Settings > Governance > Policies & Limits** as an Admin or Owner to control resource use and data handling. Choose the section that matches the problem: spending, uploads, retention, feature availability, the notice members see in chat, who may share skills with the whole organization, or who receives inbound conversations.

<Frame caption="Governance > Policies & Limits — the budget-rules table above the upload policy and retention controls.">

![The Policies and Limits governance page showing three monthly budget rules — one for the entire organization, one default for all users, and one for the developer role, each capping tokens, cost, and requests — above the upload-policy fields for allowed file types, sizes, and volume.](/images/platform/governance-policies-limits.webp)

</Frame>

## Add a spending budget

1. Under **Budget rules**, select **Add rule**.
2. Choose the scope and its target. Use a role for a group such as Editors, a team for a shared workload, a project for everything spent in one project, a user for an individual, an API key for one credential, or the organization for a shared ceiling. The API key list offers every active key that works in the organization, named with whom it belongs to: a member's own key, a key an Admin made for a member, and the keys of a team, a project, or the organization itself. You can cap one person's script or coding tool, or one team's integration.
3. Select a daily, weekly, or monthly period. Enter at least one positive token, cost, or request limit. Cost is entered in USD; an empty field leaves that dimension uncapped by this rule.
4. Optionally set **Warning threshold (%)** between 0 and 100 to warn before the cap is reached. A project budget has no warning threshold.
5. Select **Confirm**, save the pending page changes, and check the saved rule's scope, target, period, and limits.

For example, a monthly role rule can give Editors a USD 50 personal spending limit, while an organization rule caps everyone's combined spend at USD 500. These are example amounts, not recommended defaults.

A rule stays in the table after its API key stops working. **Target** still names the key and its owner, with a status: **Expired** while the expired key is still stored, **Disabled**, **Revoked** when this organization recorded its revocation, or **Former member** when the owner has left the organization. **Unavailable** means the key is known but no longer stored, without a recorded cause; expiry cleanup can produce this state. **Unknown key** marks a key this organization has no record of. Remove such a rule, or edit it and choose an active key.

Budgets apply to new billable work, including chat, voice output, transcriptions and dictation, knowledge indexing and search, managed agent runs, the `llm` steps of automations, **Improve with AI** in the inbox, the images agents generate, and calls to the model endpoints. Tale checks every chat request before it runs — a sent message, a regenerated or edited reply, both sides of a model comparison, a message waiting for an attachment, and a send through the REST API — and refuses it once a cap that applies is reached, naming the cap and when it resets. Replies still being written hold what they may spend, round by round, and so do voice output being made, an automation's `llm` step, a chat's title, **Improve with AI**, a transcription and each embedding request of knowledge indexing and search, so requests sent at the same moment cannot pass a nearly reached cap together. An agent's image request is checked the same way before the image model is called: while its images are being made it holds an estimated cost, and the check also counts what the agent's own run may still spend on its model. Each image counts as one request. Image generation needs cost or request limits because its usage is not measured as text tokens. A token limit counts input and output tokens, and input includes the part of a prompt that a provider read from or wrote to its cache. That part is priced differently from other input, so an agent that reuses a long prompt can reach a token limit while its cost stays low. Investigate warnings in [Usage analytics](/platform/admin/governance/usage-analytics).

Voice output reserves its estimated cost and one request while the attempt is pending. An automation’s `llm` step reserves the estimated prompt and permitted output at the catalog price, plus one request. These reservations share the applicable caps with chat and managed agent work. They are estimates, not a guarantee of the provider’s final charge.

If a reserved voice attempt fails or its outcome is unknown, Tale records its saved estimate and one request once, even when the failure happened before the provider call. A direct automation model call with an unknown outcome similarly records its reserved estimate. This conservative accounting does not confirm a provider charge. A retry needs a new reservation and must fit the budget including the earlier estimate.

## Understand which caps apply

Personal limits resolve each dimension from the most specific rule that defines it: user, then team, role, and default. When someone belongs to several teams with a rule, the strictest of those caps applies to them personally. Organization limits apply in addition. A team budget also caps the combined usage of the team's current members, even when a member has a more specific personal rule: a new member's usage in the current period counts at once, and someone who leaves no longer counts. API-key limits independently cap requests authenticated with that key, and those requests' usage counts toward the key; they do not cap unrelated in-app work. A team's, a project's, or the organization's own key is not a person: no user, role, or default rule applies to it. The organization's limits and its API-key rules do, a team's key counts toward, and is held to, its team's budget, and a project's key its project's.

A project budget caps everything spent in one project, whoever spends it: the project's chats, with their titles, the answers read aloud, the recordings transcribed in them, and the assistant's tool calls and searches; the files indexed for it; the runs of its agents and the agent and `llm` steps of the automations run in it, with the images they generate; and the calls made with the project's own API keys. It applies on top of the limits of whoever asked for the work, including runs a schedule started, and never to work outside the project. Pending chat replies and their titles, agent turns, voice attempts, transcriptions and automation model calls also hold their admitted usage against the project budget, so concurrent requests see those reservations. A chat message it refuses says the project's limit was reached. A project budget warns no one before it is reached. An automation counts toward the project it runs in. A run that names no project, of an automation installed in several projects, counts toward each of them and must fit each one's budget, as a member's spend counts toward each of their teams; an automation installed in no project counts toward the organization alone.

Chat turns, voice attempts and automation model calls keep the projects recorded when admitted. Moving the chat or changing an automation’s project installations while work is running does not move its reservation or eventual booking. An attempt admitted without a project stays outside project budgets.

<Frame caption="Add budget rule — a monthly cost cap for the Website relaunch project.">

![The Add budget rule dialog with the scope set to Project, Website relaunch chosen as the project, a monthly period, and a maximum cost of 200 USD; the token and request limits are left empty, and no warning threshold is offered for a project.](/images/platform/governance-budget-project-rule.webp)

</Frame>

Managed agent runs count against the person who started them. A run you start from a task, a comment, the REST API, or the MCP endpoint uses your personal and team caps, and a run started with an API key also counts toward that key. Runs that a schedule, a webhook, or an event started have no person behind them: only the organization's limits apply to them, and a project's when they run in a project, and [Usage analytics](/platform/admin/governance/usage-analytics) lists them under **Automations (triggers)**. [How usage is counted](/platform/admin/governance/usage-attribution) explains the rule for every kind of work.

A call to the [model endpoints](/develop/use-tale-from-your-editor#model-endpoints) is checked like a chat request. Before it runs, Tale works out its worst case, the estimated prompt plus the most output it may produce at the model's catalog price, and refuses it with `429 BUDGET_EXCEEDED` when that worst case does not fit what is left under a cap that applies to the key holder or to the key. While the call runs, its worst case is held against those caps. Afterwards, the cost the model gateway measured is booked under the person and the key, and each call counts as one request.

If a request is refused unexpectedly, check all applicable caps and their periods. Increasing one personal limit does not remove an organization, shared-team, project, or API-key ceiling.

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

The custom-instructions default switch stores the organization default for members’ personal instructions: while it is on, every member’s custom instructions apply to their chat replies unless they turned the feature off themselves under **Settings > Preferences**. Organization-wide mandatory instructions are a separate setting under [Guardrails](/platform/admin/governance/guardrails).

## Show a confidentiality notice in chat

**Confidentiality notice** adds a short line under the chat message field for every member of your organization, such as a reminder not to share sensitive data. It stays off until you turn it on.

1. Turn on the **Confidentiality notice** switch. Members see the notice in chat right away, in their language; open chats update without reloading.
2. Optionally enter your own text in the language tabs **English**, **Deutsch**, and **Français**, up to 280 characters per language. Save the pending page changes.

<Frame caption="Governance > Policies & Limits — the confidentiality notice switched on, with English text, a German translation, and French still untranslated.">

![The Confidentiality notice section with its switch on and the English tab selected, asking members not to paste client names, contract values, or unreleased project codenames into chat; the Français tab is marked untranslated.](/images/platform/governance-confidentiality-notice.webp)

</Frame>

Members see the text for their language. A tab marked **untranslated** has no text of its own: members reading that language see your English text, or the default notice when English is empty too, and the empty field previews that text. A red dot marks a language whose text is too long, and saving stays unavailable until you shorten it. Turning the notice off keeps your texts for when you turn it on again.

The notice is a reminder only. It does not check, block, or change what members send. To act on sensitive content, configure [Guardrails](/platform/admin/governance/guardrails).

## Decide who shares skills with everyone {#skill-sharing}

By default, every member can share a skill with the whole organization. Use **Skill sharing** to reserve that for fewer people: choose who may **Share skills with the organization**, then save the pending page changes.

- **Every member** keeps the default.
- **Editors and above** admits Editors, Developers, Admins, and Owners: the roles that equip agents.
- **Owners and admins only** admits Owners and Admins.

<Frame caption="Governance > Policies & Limits — Skill sharing decides who may share a skill with the whole organization.">

![The Skill sharing section with Share skills with the organization set to Every member, and the hint that Owners and Admins always may and one more member can be granted Publish skills to the organization under Competences.](/images/platform/governance-skill-sharing.webp)

</Frame>

Owners and Admins can always share with everyone. To let one more person do it without a higher role, grant them **Publish skills to the organization** under [Competences](/platform/admin/governance/competences).

Everyone else can still create skills and share them with their own teams. They cannot create a skill for the whole organization, widen one of theirs to **Organization**, or change an organization-wide skill in place. They can narrow a skill of theirs to their teams, with other changes in the same save, or delete it. The rule applies in the skill editor, to zip and folder uploads, to automation packages that carry skills, and to the REST API. Each refusal appears in the [audit logs](/platform/admin/governance/audit-logs) as **Skill publishing refused**.

A stricter setting does not narrow skills that are already shared with the organization. To review them, open **Settings > Skills**, choose **Filter > Visibility > Organization**, and check the **Created by** column. Narrow or delete the ones that should not stay shared with everyone.

<Note>

A managed configuration release installs its skills as the member who deploys it. Before you choose a stricter setting, make sure that member can still share with everyone, through their role or the competence; otherwise the next release that carries an organization-wide skill is refused.

</Note>

## Conversation routing

Use **Conversation routing** to assign new conversations by where they arrive. Add a rule, set its fields, then save it:

- **Arrives on**: **Any mailbox**, one mailbox by its name, or an API app. An API app is listed once it has synced a conversation.
- **Sent to**: the address the conversation was sent to. It is required for **Any mailbox**, optional for one mailbox, and absent for an API app. Address matching ignores case.
- **Route to**: a team, a person, or both.

A rule for `support@example.com` also catches plus-addressed mail such as `support+billing@example.com`, and a rule for the tagged address wins for that address. When several rules match, the most specific one applies: a mailbox with its exact address, then a mailbox with the base address, then an address on any mailbox, then a mailbox alone.

A team assignment makes the conversation visible to that team's members; a person assignment makes it visible to that person. When both are set, either membership grants visibility. Unassigned conversations are for Admin and Owner triage.

Rules apply when a new conversation arrives. They do not reassign an existing conversation when a reply joins it. If a rule points to a deleted person, team, or mailbox, the conversation still arrives without that routing assignment. Test with a new message and verify the resulting assignee.

## Configure sign-in limits separately

Enable **Enable password rotation** and set **Rotation period (days)** to require members to change their password when that period expires. The **Password change required** screen appears then and asks the member to set a new password before continuing. Password requirements, sign-in attempt limits, session idle timeout, and [two-factor policy](/platform/admin/two-factor-authentication) live under **Settings > Governance > Security**. An organization idle timeout can tighten the deployment's limit. For trusted-header authentication, coordinate session expiry with the proxy or identity provider, which can authenticate the member again.
