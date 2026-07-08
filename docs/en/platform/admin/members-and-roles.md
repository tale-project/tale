---
title: Members and roles
description: The six roles that ship with Tale and the resource-level matrix that says who can do what. Admins and Owners read this when they set up a team or when an audit asks who has access to what.
---

Members are the people in your organisation who can sign in to Tale. Roles control what each member can do — read, write, configure, govern. This page is the canonical reference for the six roles and the resource-level permissions each role carries.

Six roles cover almost every team Tale ships to. Admins and Owners read this page when they are setting up a team for the first time, when an audit asks who has access to what, or when they need to know whether to give a new hire Editor or Developer.

## A worked invite

To add a person to your organisation, open **Settings > People** and click **Add member**. The new member receives an email link valid for 24 hours and lands in the default role you pick — change the role on the form before sending if they should not be a Member. The default applies the moment they accept the invite; promoting later is a one-click change in the same People view.

## The six roles

**Owner** has every permission Admin has, plus the one Admin lacks: transferring ownership and deleting the organisation. Most teams have exactly one Owner; some keep two for continuity.

**Admin** governs the organisation: members, providers, branding, governance policies, integrations, the audit log. Admins do everything Editor does and everything Developer does, plus the configuration surface. They cannot transfer ownership.

**Developer** builds: agents, workflows, integrations, API keys, MCP servers. Developers can read every resource and write to most of them, including governance policies (read-only). Reach for Developer when someone needs the API plane and the integration tooling.

**Editor** curates and operates: agents, the knowledge base (documents, customers, products, vendors, websites), the conversation inbox, approvals, the prompt library. Editors can read workflows but not modify them; they can read integrations but not configure them. Reach for Editor when someone runs the day-to-day product work without touching the API or integration plane.

**Member** runs: chat, browse the knowledge base, read conversations and approvals others have assigned to them. Members write only to message feedback (thumbs up / down). Reach for Member as the default — most users in most organisations are Members.

**Disabled** has no permissions. Use it to revoke access without deleting the account; transcripts and audit history stay intact, and re-enabling restores the previous role.

## The permission matrix

| Resource              | Owner | Admin | Developer | Editor | Member | Disabled |
| --------------------- | ----- | ----- | --------- | ------ | ------ | -------- |
| Agents                | R / W | R / W | R / W     | R / W  | R      | —        |
| Documents             | R / W | R / W | R / W     | R / W  | R      | —        |
| Products              | R / W | R / W | R / W     | R / W  | R      | —        |
| Customers             | R / W | R / W | R / W     | R / W  | R      | —        |
| Vendors               | R / W | R / W | R / W     | R / W  | R      | —        |
| Projects              | R / W | R / W | R / W     | R / W  | R      | —        |
| Websites              | R / W | R / W | R / W     | R / W  | R      | —        |
| Conversations         | R / W | R / W | R / W     | R / W  | R      | —        |
| Conversation messages | R / W | R / W | R / W     | R / W  | R      | —        |
| Approvals             | R / W | R / W | R / W     | R / W  | R      | —        |
| Workflow executions   | R / W | R / W | R / W     | R      | R      | —        |
| Workflow processing   | R / W | R / W | R / W     | R      | R      | —        |
| Integrations          | R / W | R / W | R / W     | R      | R      | —        |
| OneDrive sync configs | R / W | R / W | R / W     | R      | R      | —        |
| Prompt templates      | R / W | R / W | R / W     | R / W  | R      | —        |
| Audit logs            | R / W | R / W | R / W     | R / W  | R      | —        |
| Governance policies   | R / W | R / W | R         | R      | R      | —        |
| Message feedback      | R / W | R / W | R / W     | R / W  | R / W  | —        |
| MCP servers           | R / W | R / W | R / W     | R      | R      | —        |

R = read, W = write, — = no access. The matrix is the authoritative description of what each role can do across the resources Tale tracks; the rows are the same set the in-product permission system uses at request time.

## The Settings surface and the menu

Members, Editors, and Disabled users do not see Settings — the menu is hidden. Developers see Settings but not the governance sub-tree (except read views). Admins and Owners see the full menu. The three sidebar groups (`You`, `Workspace`, `Governance`) reflect this split: `You` is per-user, `Workspace` is configuration, `Governance` is the audit-and-policy surface that needs Admin access.

## Edge cases

**Transferring ownership** requires an existing Owner to nominate a current Admin or Owner; the new Owner role takes effect immediately. The previous Owner becomes Admin unless explicitly downgraded.

**Last Admin warning.** The People view warns when removing or downgrading the last Admin or Owner. The action is allowed — Tale does not lock you out — but you should keep at least two Admin-or-Owner accounts for continuity.

**Resetting 2FA** is on the member's row in People. Resetting clears the second factor; the next sign-in re-enrolls.

## Where this fits

Roles are the access surface every other admin page touches: SSO authenticates them, API keys belong to them, audit logs name them, governance policies scope behaviour by role. The next page worth reading depends on what you are doing next. If you are wiring sign-in to your identity provider, [authentication](/self-hosted/configuration/authentication) covers the four sign-in modes. If you are scoping access by team rather than by role alone, [Teams](/platform/admin/teams) covers the per-team scoping layer.
