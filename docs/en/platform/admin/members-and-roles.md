---
title: Members and roles
description: Manage who can access your organisation and what they can do.
---

Tale uses six roles. Every user belongs to exactly one role within an organisation. The same person can have different roles in different organisations.

## Managing members

The member table under **Settings > Members** lists all users in the organisation with their email, display name, role, and join date. Admins can:

- **Add members** — enter an email, optional password, display name, and role. If the email already exists in Tale, the user is added to the organisation without creating a new account.
- **Edit members** — change a member's display name, role, or set a new password for them.
- **Remove members** — remove the member from the organisation. Their account is not deleted; they lose access to this organisation only.

For authentication options (password, Microsoft Entra ID SSO, trusted headers), see [Authentication](/self-hosted/admin/authentication).

## Role overview

| Role      | Who it's for                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Owner     | Organization creator. Same permissions as Admin with the ability to transfer ownership.                                              |
| Admin     | Full control over the organization. Manages members, settings, integrations, and all content.                                        |
| Developer | For engineers and integration builders. Full data access but cannot manage members or organization settings.                         |
| Editor    | For content and customer service staff. Creates knowledge base content, handles conversations, manages agents, and approves actions. |
| Member    | Read-only access. Can use AI chat to explore data but cannot create or edit content.                                                 |
| Disabled  | Account suspended. Cannot access any features.                                                                                       |

## Permission matrix

### AI chat

| Feature                  | Member | Editor | Developer | Admin |
| ------------------------ | ------ | ------ | --------- | ----- |
| Create and send messages | ✓      | ✓      | ✓         | ✓     |
| View own chat history    | ✓      | ✓      | ✓         | ✓     |
| Select agent             | ✓      | ✓      | ✓         | ✓     |

### Knowledge base

| Feature                             | Member | Editor | Developer | Admin |
| ----------------------------------- | ------ | ------ | --------- | ----- |
| View all knowledge items            | ✓      | ✓      | ✓         | ✓     |
| Upload / edit / delete documents    | —      | ✓      | ✓         | ✓     |
| Manage products, customers, vendors | —      | ✓      | ✓         | ✓     |
| Add and configure website crawling  | —      | ✓      | ✓         | ✓     |

### Conversations

| Feature                                | Member | Editor | Developer | Admin |
| -------------------------------------- | ------ | ------ | --------- | ----- |
| View conversations                     | ✓      | ✓      | ✓         | ✓     |
| Reply to customers                     | —      | ✓      | ✓         | ✓     |
| Close / reopen / archive conversations | —      | ✓      | ✓         | ✓     |
| Mark as spam                           | —      | ✓      | ✓         | ✓     |

### Approvals

| Feature                   | Member | Editor | Developer | Admin |
| ------------------------- | ------ | ------ | --------- | ----- |
| View pending approvals    | ✓      | ✓      | ✓         | ✓     |
| Approve or reject actions | —      | ✓      | ✓         | ✓     |

### Agents

| Feature                | Member | Editor | Developer | Admin |
| ---------------------- | ------ | ------ | --------- | ----- |
| View agent list        | —      | ✓      | ✓         | ✓     |
| Create and edit agents | —      | ✓      | ✓         | ✓     |

### Automations

| Feature                          | Member | Editor | Developer | Admin |
| -------------------------------- | ------ | ------ | --------- | ----- |
| View automation list             | —      | —      | ✓         | ✓     |
| Create and edit automations      | —      | —      | ✓         | ✓     |
| Publish and activate automations | —      | —      | ✓         | ✓     |
| View execution logs              | —      | —      | ✓         | ✓     |

### Integrations and API

| Feature                      | Member | Editor | Developer | Admin |
| ---------------------------- | ------ | ------ | --------- | ----- |
| View integrations            | —      | —      | ✓         | ✓     |
| Configure integrations       | —      | —      | ✓         | ✓     |
| Generate and revoke API keys | —      | —      | ✓         | ✓     |

### Organization administration

| Feature                             | Member | Editor | Developer | Admin |
| ----------------------------------- | ------ | ------ | --------- | ----- |
| View organization settings          | —      | —      | —         | ✓     |
| Edit organization name and branding | —      | —      | —         | ✓     |
| Add and remove members              | —      | —      | —         | ✓     |
| Change member roles                 | —      | —      | —         | ✓     |

## Authentication

Tale supports email/password, Microsoft Entra ID SSO, and trusted headers authentication. All methods can be used simultaneously.

For full setup instructions, see the [Authentication guide](/self-hosted/admin/authentication).

## Where this fits

Members and roles is the page every other admin page assumes. Authentication answers _who can sign in at all_; Providers answers _which models the organisation can spend money on_; Governance answers _what rules apply to what they do_ — but none of those questions has a meaningful answer until you've decided who can do what, and that's this page.

The natural next move depends on which question you came here for. To wire up sign-in beyond email/password, [Authentication](/self-hosted/admin/authentication) covers SSO and trusted headers. To group members for shared access, [Teams](/platform/admin/teams) does that. To audit who did what, [Governance](/platform/admin/governance) covers the audit log.
