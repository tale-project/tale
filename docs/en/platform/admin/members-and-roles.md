---
title: Members and roles
description: The canonical six-role permission matrix — who can see and do what in a Tale organisation, and how Admins invite, edit, and remove members.
---

Every person in a Tale organisation belongs to exactly one of six roles, and that role decides which screens they see, which buttons are enabled, and which API calls succeed. This page is for Admins and Owners running the organisation, and it doubles as the canonical reference the rest of the docs link into when a feature says "Editor or higher" or "Developer only". The same person can hold different roles in different organisations — roles are scoped per organisation, not per user.

The role list is closed: `Owner`, `Admin`, `Developer`, `Editor`, `Member`, `Disabled`. There is no custom-role builder, and the matrix below is the source of truth — when a button is hidden for your role, this page is why.

## Manage members

Open **Settings > Members**. The table lists every user in the organisation with their email, display name, role, and join date, plus a row-level action menu for Admins.

- **Add member** — opens a dialog asking for email, optional initial password, display name, and role. If the email already has a Tale account, that account is attached to the organisation instead of a duplicate being created. New password-authenticated accounts are flagged with **User must update the password on login** so the temporary password the Admin sets does not survive the first sign-in.
- **Edit member** — change display name, role, or set a new password. Admins cannot change their own role from this dialog (use **Transfer ownership** below for that). Lowering an Admin to a lower role is blocked when it would leave fewer than two Admins in the organisation.
- **Reset two-factor** — disables the member's TOTP enrolment, ends every active session of theirs, and forces them to re-enrol on next sign-in. Use it when someone loses their authenticator and has exhausted their backup codes. Each reset is recorded in the audit log.
- **Remove member** — detaches the member from this organisation. The underlying account is not deleted; they keep access to any other organisation they belong to.
- **Transfer ownership** — only available to the current Owner. Promotes the chosen member to Owner and demotes the current Owner to Admin. Every organisation has exactly one Owner.

For sign-in mechanics (password, Microsoft Entra ID SSO, trusted reverse-proxy headers, password rotation), see [Authentication](/self-hosted/admin/authentication). For org-wide two-factor policy, see [Two-factor authentication](/platform/admin/two-factor-authentication).

## The six roles

| Role      | What this role is for                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner     | The person who created the organisation. Same permissions as Admin, plus the ability to transfer ownership and delete the organisation. Exactly one Owner per organisation.                                                           |
| Admin     | Full control of the organisation. Manages members, providers, branding, governance, retention, audit log, and everything below.                                                                                                       |
| Developer | The build-and-integrate seat. Creates and edits agents and automations, configures integrations and MCP servers, manages API keys. No access to org-wide admin surfaces.                                                              |
| Editor    | The content-curation seat. Uploads and edits knowledge, manages products / customers / vendors / websites, replies in conversations, decides approvals, and edits agents. No access to automations, integrations, API keys, or admin. |
| Member    | The read-only consumer. Chats with AI and agents, reads the knowledge base, reads conversations and approvals. Cannot write to any of those surfaces.                                                                                 |
| Disabled  | Suspended account. Sign-in is rejected for this organisation. The underlying user record stays so the account can be reactivated by changing the role.                                                                                |

`Owner` is a strict superset of `Admin` — every Admin permission below also belongs to Owner. The matrix from here on lists `Admin` to keep columns short.

## Permission matrix

The matrix is grouped by product area. A `✓` means the role has the action; `—` means the action is hidden or rejected for the role.

### AI chat

| Action                   | Member | Editor | Developer | Admin |
| ------------------------ | ------ | ------ | --------- | ----- |
| Create and send messages | ✓      | ✓      | ✓         | ✓     |
| View own chat history    | ✓      | ✓      | ✓         | ✓     |
| Pick an agent in chat    | ✓      | ✓      | ✓         | ✓     |

### Knowledge base

| Action                              | Member | Editor | Developer | Admin |
| ----------------------------------- | ------ | ------ | --------- | ----- |
| View all knowledge items            | ✓      | ✓      | ✓         | ✓     |
| Upload, edit, or delete documents   | —      | ✓      | ✓         | ✓     |
| Manage products, customers, vendors | —      | ✓      | ✓         | ✓     |
| Add and configure website crawling  | —      | ✓      | ✓         | ✓     |

### Conversations

| Action                                   | Member | Editor | Developer | Admin |
| ---------------------------------------- | ------ | ------ | --------- | ----- |
| View conversations                       | ✓      | ✓      | ✓         | ✓     |
| Reply to customers                       | —      | ✓      | ✓         | ✓     |
| Close, reopen, or archive a conversation | —      | ✓      | ✓         | ✓     |
| Mark a conversation as spam              | —      | ✓      | ✓         | ✓     |

### Approvals

| Action                      | Member | Editor | Developer | Admin |
| --------------------------- | ------ | ------ | --------- | ----- |
| View pending approvals      | ✓      | ✓      | ✓         | ✓     |
| Approve or reject an action | —      | ✓      | ✓         | ✓     |

### Agents

| Action                  | Member | Editor | Developer | Admin |
| ----------------------- | ------ | ------ | --------- | ----- |
| View the agent list     | —      | ✓      | ✓         | ✓     |
| Create or edit an agent | —      | ✓      | ✓         | ✓     |
| Delete an agent         | —      | ✓      | ✓         | ✓     |

### Automations

| Action                             | Member | Editor | Developer | Admin |
| ---------------------------------- | ------ | ------ | --------- | ----- |
| View the automation list           | —      | —      | ✓         | ✓     |
| Create or edit an automation       | —      | —      | ✓         | ✓     |
| Publish and activate an automation | —      | —      | ✓         | ✓     |
| View execution logs                | —      | —      | ✓         | ✓     |

### Integrations, MCP, API keys

| Action                    | Member | Editor | Developer | Admin |
| ------------------------- | ------ | ------ | --------- | ----- |
| View integrations         | —      | —      | ✓         | ✓     |
| Configure integrations    | —      | —      | ✓         | ✓     |
| Configure MCP servers     | —      | —      | ✓         | ✓     |
| Create or revoke API keys | —      | —      | ✓         | ✓     |

### Organisation administration

| Action                                                | Member | Editor | Developer | Admin |
| ----------------------------------------------------- | ------ | ------ | --------- | ----- |
| View organisation settings                            | —      | —      | —         | ✓     |
| Edit organisation name and branding                   | —      | —      | —         | ✓     |
| Configure AI providers                                | —      | —      | —         | ✓     |
| Configure governance (budgets, retention, guardrails) | —      | —      | —         | ✓     |
| Read and export the audit log                         | —      | —      | —         | ✓     |
| Add or remove members                                 | —      | —      | —         | ✓     |
| Change member roles                                   | —      | —      | —         | ✓     |
| Manage teams                                          | —      | —      | —         | ✓     |
| File data-subject requests                            | —      | —      | —         | ✓     |

### Owner-only

Only the Owner can do these:

- **Transfer ownership** to another member (demotes the current Owner to Admin).
- **Delete the organisation** — removes its agents, automations, providers, and integrations; every member loses access. This cannot be undone.

## How role checks are enforced

Roles are checked server-side on every Convex query, mutation, and action — the UI's hidden buttons are a convenience, not the gate. A page that "shouldn't show" is still rejected with `insufficient role` if you reach it by URL. The `Disabled` role bypasses the rest of the matrix: the access-denied screen is the only surface a Disabled user sees.

The two-Admins-minimum rule is enforced when changing roles and when removing members, so an organisation cannot be left with zero or one Admin. The same rule does not bind the Owner: a single-Owner-one-Admin organisation is legal because Owner is itself an Admin.

## Where this fits

Members and roles is the page every other admin page assumes. [Authentication](/self-hosted/admin/authentication) decides _who can sign in at all_ and through which method; [AI providers](/platform/admin/providers) decides _which models the organisation can spend money on_; [Governance](/platform/admin/governance) decides _what rules apply to what they do_ — none of those questions has a useful answer until you have decided who can do what, and that lives here.

The next move depends on what brought you. To wire up sign-in beyond email and password, [Authentication](/self-hosted/admin/authentication) covers SSO and trusted headers. To scope knowledge and conversations across the organisation, [Teams](/platform/admin/teams) does that. To audit who did what, the audit log lives under [Governance](/platform/admin/governance).
