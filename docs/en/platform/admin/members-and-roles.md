---
title: Members and roles
description: Add people, choose their permissions, and manage account access.
---

Add people under **Settings > Members**, then choose the role that matches their work. Roles determine permitted actions; project access, teams, and conversation assignments determine which resources a person can reach.

<Video src="/videos/en/tutorials/ep8-people/ep8-people.en.mp4" poster="/videos/en/tutorials/ep8-people/ep8-people.en.webp" captions="/videos/en/tutorials/ep8-people/ep8-people.en.vtt" lang="en" title="Episode 8 — People, roles & teams" caption="Episode 8 — People, roles & teams (2:15)">

</Video>

<Frame caption="Settings > Members — every account and the role that bounds it.">

![The Members settings page listing the workspace owner and four more people, each with a role badge, beside an Add member button.](/images/get-started/settings-organization-members.webp)

</Frame>

## Add a person

You need an Owner or Admin account to manage members.

1. Open **Settings > Members** and select **Add member**.
2. Enter the person's **Email** and, optionally, **Name**.
3. Choose a **Role**. Start with Member for everyday use; the comparison below explains when to grant more access.
4. For a new Tale account, enter a **Password** that meets the displayed policy. If the email already belongs to an account, Tale reuses its credentials and hides the password field.
5. Select **Add member**. For a new account, save the credentials shown in the confirmation before closing it, then share them through your organization's approved channel.

The person appears in the member list. Tale does not send an invitation or password-reset email for this flow: adding someone is your confirmation of their address, so the account works everywhere at once — including applications people sign in to with their Tale account. If the address is already a member of this organization, the form reports that instead of adding a duplicate.

<Tip>

After adding a person, assign the teams they need. A role alone does not put them into a team's project access or conversation queue.

</Tip>

## Choose a role

| Role | Typical work | Organization administration |
| --- | --- | --- |
| **Owner** | All product and administration work | Includes transferring ownership and deleting the organization. |
| **Admin** | Manage people, services, policies, and the team's work | Full organization settings; cannot transfer ownership. |
| **Developer** | Build agents, automations, and integrations | Technical settings such as providers, connectors, and API access; no member administration. |
| **Editor** | Maintain content and operate day-to-day work | Content editing; workflow and connector resources are read-only. |
| **Member** | Use chat and read resources shared with them | No organization administration; can submit message feedback. |
| **Disabled** | No active access | Retains the membership record without granting permissions. |

These are role capabilities, not a promise that every record is visible. Conversation reads follow assignment: a person sees work assigned to them or their teams; unassigned conversations remain with Owners and Admins for triage. See [conversation routing](/platform/admin/governance/policies-and-limits#conversation-routing).

Audit-log viewing is restricted to Owners and Admins. Actions by other roles can still produce audit entries; producing an entry does not grant access to the log.

## Change a role or reset a password

Open the person's row menu, choose **Edit**, and change **Role**. Select **Save**, then check the role badge in the list. To restore a disabled member's access, explicitly select the role they should receive.

The edit dialog also changes the display name. Email is read-only. To set a replacement password, enable **Update password**, enter a password that meets the displayed requirements, and save. Use your organization's identity-checking process before resetting an account.

You cannot edit your own role through this menu, assign Owner through the role picker, or demote the last administrator. Existing Owners and the organization creator also have protected roles. If a change is refused, check the relevant account before trying a different role.

## Transfer ownership

An Owner can choose **Transfer ownership** from another member's row menu. Read the confirmation carefully: the selected person becomes Owner and the transferring Owner becomes Admin. Use this action for an ownership handover, not an ordinary role promotion.

## Remove or recover access

Use **Disabled** when access should stop while the membership remains. Use the row's **Delete** action to remove the membership from this organization. Review shared work and team responsibilities first; removing membership is different from a [data subject erasure request](/platform/admin/governance/data-subject-requests).

If a member loses an authenticator or passkey, open **Edit** and use the relevant security controls. [Two-factor authentication](/platform/admin/two-factor-authentication) explains reset, recovery, and session consequences.
