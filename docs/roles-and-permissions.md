---
title: Roles and permissions
description: Role overview, permission matrix, and SSO configuration.
---

Tale uses five roles. Every user belongs to exactly one role within an organization. The same person can have different roles in different organizations.

## Role overview

| Role | Who it's for |
| --- | --- |
| Admin | Full control over the organization. Manages members, settings, integrations, and all content. |
| Developer | For engineers and integration builders. Full data access but cannot manage members or organization settings. |
| Editor | For content and customer service staff. Creates knowledge base content, handles conversations, and approves actions. |
| Member | Read-only access. Can use AI chat to explore data but cannot create or edit content. |

## Permission matrix

### AI chat

| Feature | Member | Editor | Developer | Admin |
| --- | --- | --- | --- | --- |
| Create and send messages | ✓ | ✓ | ✓ | ✓ |
| View own chat history | ✓ | ✓ | ✓ | ✓ |
| Delete and rename conversations | ✓ | ✓ | ✓ | ✓ |
| Select agent | ✓ | ✓ | ✓ | ✓ |

### Knowledge base

| Feature | Member | Editor | Developer | Admin |
| --- | --- | --- | --- | --- |
| View all knowledge items | ✓ | ✓ | ✓ | ✓ |
| Upload / edit / delete documents | — | ✓ | ✓ | ✓ |
| Manage products, customers, vendors | — | ✓ | ✓ | ✓ |
| Add and configure website crawling | — | ✓ | ✓ | ✓ |

### Conversations

| Feature | Member | Editor | Developer | Admin |
| --- | --- | --- | --- | --- |
| View conversations | ✓ | ✓ | ✓ | ✓ |
| Reply to customers | — | ✓ | ✓ | ✓ |
| Close / reopen / archive conversations | — | ✓ | ✓ | ✓ |
| Mark as spam | — | ✓ | ✓ | ✓ |

### Approvals

| Feature | Member | Editor | Developer | Admin |
| --- | --- | --- | --- | --- |
| View pending approvals | ✓ | ✓ | ✓ | ✓ |
| Approve or reject actions | — | ✓ | ✓ | ✓ |

### Automations and agents

| Feature | Member | Editor | Developer | Admin |
| --- | --- | --- | --- | --- |
| View automation list | — | — | ✓ | ✓ |
| Create and edit automations | — | — | ✓ | ✓ |
| Publish and activate automations | — | — | ✓ | ✓ |
| View execution logs | — | — | ✓ | ✓ |

### Integrations and API

| Feature | Member | Editor | Developer | Admin |
| --- | --- | --- | --- | --- |
| View integrations | — | — | ✓ | ✓ |
| Configure integrations | — | — | ✓ | ✓ |
| Generate and revoke API keys | — | — | ✓ | ✓ |

### Organization administration

| Feature | Member | Editor | Developer | Admin |
| --- | --- | --- | --- | --- |
| View organization settings | — | — | — | ✓ |
| Edit organization name and branding | — | — | — | ✓ |
| Add and remove members | — | — | — | ✓ |
| Change member roles | — | — | — | ✓ |

## Authentication

Tale supports email/password, Microsoft Entra ID SSO, and trusted headers authentication. All methods can be used simultaneously.

For full setup instructions, see the [Authentication guide](/authentication).
