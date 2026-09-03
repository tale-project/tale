---
title: Members and roles
description: The six roles that ship with Tale and the resource-level matrix that says who can do what. Admins and Owners read this when they set up a team or when an audit asks who has access to what.
---

Members are the people in your organisation who can sign in to Tale. Roles control what each member can do — read, write, configure, govern. This page is the canonical reference for the six roles and the resource-level permissions each role carries.

Six roles cover almost every team Tale ships to. Admins and Owners read this page when they are setting up a team for the first time, when an audit asks who has access to what, or when they need to know whether to give a new hire Editor or Developer.

Prefer to watch first? Episode 8 walks the roster, the role ladder, and the team walls in two minutes — captions included.

<Video src="/videos/en/tutorials/ep8-people/ep8-people.en.mp4" poster="/videos/en/tutorials/ep8-people/ep8-people.en.webp" captions="/videos/en/tutorials/ep8-people/ep8-people.en.vtt" lang="en" title="Episode 8 — People, roles & teams" caption="Episode 8 — People, roles & teams (2:15)">

</Video>

<Frame caption="The Members section under Settings > Organization — every account and the role that bounds it.">

![The Organization settings page with its Members section listing the workspace owner and an Add member button.](/images/get-started/settings-organization-members.webp)

</Frame>

## Adding a member

To add a person to your organisation, open **Settings > Organization**, scroll to the **Members** section, and click **Add member**. Fill in their **Name**, **Email**, and **Role**, and set a **Password** — Tale does not send an email invite, so a password is required to create a new account. (If the email already belongs to a Tale account, no password is asked: the person signs in with their existing credentials and is simply added to this organisation.)

On **Add member**, Tale shows the new sign-in credentials **once**, with the reminder to save them now because they won't be shown again. Relay them to the new member out of band — there is no reset email. Anyone who later forgets their password contacts an admin, who can set a new one from the same Members section.

Pick the role on the form before you submit; promoting or changing it later is a one-click change in the same Members section.

## The six roles

**Owner** has every permission Admin has, plus the one Admin lacks: transferring ownership and deleting the organisation. Most teams have exactly one Owner; some keep two for continuity.

**Admin** governs the organisation: members, providers, branding, governance policies, connectors, the audit log. Admins do everything Editor does and everything Developer does, plus the configuration surface. They cannot transfer ownership.

**Developer** builds: agents, workflows, connectors, API keys. Developers can read every resource and write to most of them, including governance policies (read-only). Reach for Developer when someone needs the API plane and the connector tooling.

**Editor** curates and operates: agents, the knowledge base (documents, contacts, products, vendors, websites), the conversation inbox, approvals, the skill library. Editors can read workflows but not modify them; they can read connectors but not configure them. Reach for Editor when someone runs the day-to-day product work without touching the API or connector plane.

**Member** runs: chat, browse the knowledge base, and read conversations and approvals. Conversation read is assignment-scoped: Members see threads assigned to them or queued to their teams; true unassigned mail is admin triage only — use [Conversation routing](/platform/admin/governance/policies-and-limits#conversation-routing) so inbound lands in a team queue on arrival. Members write only to message feedback (thumbs up / down). Reach for Member as the default — most users in most organisations are Members.

**Disabled** has no permissions. Use it to revoke access without deleting the account; transcripts and audit history stay intact, and re-enabling restores the previous role.

## The permission matrix

| Resource                  | Owner | Admin | Developer | Editor | Member | Disabled |
| ------------------------- | ----- | ----- | --------- | ------ | ------ | -------- |
| Agents                    | R / W | R / W | R / W     | R / W  | R      | —        |
| Documents                 | R / W | R / W | R / W     | R / W  | R      | —        |
| Products                  | R / W | R / W | R / W     | R / W  | R      | —        |
| Contacts                  | R / W | R / W | R / W     | R / W  | R      | —        |
| Vendors                   | R / W | R / W | R / W     | R / W  | R      | —        |
| Projects                  | R / W | R / W | R / W     | R / W  | R      | —        |
| Websites                  | R / W | R / W | R / W     | R / W  | R      | —        |
| Conversations             | R / W | R / W | R / W     | R / W  | R      | —        |
| Conversation messages     | R / W | R / W | R / W     | R / W  | R      | —        |
| Approvals                 | R / W | R / W | R / W     | R / W  | R      | —        |
| Workflow executions       | R / W | R / W | R / W     | R      | R      | —        |
| Workflow processing       | R / W | R / W | R / W     | R      | R      | —        |
| Connectors                | R / W | R / W | R / W     | R      | R      | —        |
| OneDrive sync configs     | R / W | R / W | R / W     | R      | R      | —        |
| Google Drive sync configs | R / W | R / W | R / W     | R      | R      | —        |
| Audit logs                | R / W | R / W | R / W     | R / W  | R      | —        |
| Governance policies       | R / W | R / W | R         | R      | R      | —        |
| Message feedback          | R / W | R / W | R / W     | R / W  | R / W  | —        |

R = read, W = write, — = no access. The matrix is the authoritative description of what each role can do across the resources Tale tracks; the rows are the same set the in-product permission system uses at request time. The audit-log pages themselves are visible to Admins and Owners only, whatever the matrix row says about reads.

## The Settings surface and the menu

Members, Editors, and Disabled users do not see the configuration surface — only their personal settings plus the org's skill library. Developers see the developer surface (AI providers, connectors, sandboxes, the API section) but not the governance sub-tree. Admins and Owners see everything. The settings menu is grouped into **Personal** (Account, Preferences, Notifications, Environment — every role), **Organization** (Teams, Members, AI providers, Branding, Governance, Metrics, and the rest — Admin-and-Owner, with Developers seeing a subset), and **Advanced** (the API, Enterprise SSO, and data-residency surface). Governance is an item inside the Organization group, not a group of its own, and it needs Admin access.

## Edge cases

**Transferring ownership** is on the member's row menu — confirm, and the target becomes Owner while you are demoted to Admin, effective immediately.

**The last Admin stays.** Tale refuses to demote the last Admin — the change comes back with _The last admin cannot be demoted_. Two more guards sit beside it: the Owner role only moves through **Transfer ownership**, and the organisation creator's role is immutable.

**Resetting 2FA** is on the member's row in the Members section. Resetting clears the second factor; the next sign-in re-enrolls.

## Where this fits

Roles are the access surface every other admin page touches: SSO authenticates them, API keys belong to them, audit logs name them, governance policies scope behaviour by role. The next page worth reading depends on what you are doing next. If you are wiring sign-in to your identity provider, [authentication](/self-hosted/configuration/authentication) covers the four sign-in modes. If you are scoping access by team rather than by role alone, [Teams](/platform/admin/teams) covers the per-team scoping layer.
