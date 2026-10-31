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

A password set or reset by an administrator, or an expired password under the organization's rotation policy, requires the member to complete the change at sign-in. See [the member-facing password-change steps](/platform/member/preferences#when-a-password-change-is-required).


<Tip>

After adding a person, assign the teams they need. A role alone does not put them into a team's project access or conversation queue.

</Tip>

## Choose a role

| Role | Typical work | Organization administration |
| --- | --- | --- |
| **Owner** | All product and administration work | Includes transferring ownership and [deleting the organization](/platform/admin/organization#delete-the-organization), which also deletes its sandboxes and their files; deleting asks you to type the organization's name before the button enables. |
| **Admin** | Manage people, services, policies, and the team's work | Full organization settings; cannot transfer ownership. |
| **Developer** | Build agents, automations, and integrations | Technical settings such as providers, connectors, and API access; no member administration. |
| **Editor** | Maintain content and operate day-to-day work | Content editing; no access to **Automations**; connector resources are read-only. |
| **Member** | Use chat, read resources shared with them, and create project tasks, working their own tasks with project agents | No organization administration; can submit message feedback. |
| **Disabled** | No active access | Retains the membership record without granting permissions. |

Only Owners, Admins, and Developers see **Automations**, in the navigation and in projects; anyone else who follows a link to an automation sees **Access denied**.

People who are not Owners or Admins cannot open **Settings > Members**; they see their own role under [**Settings > Account > Your role**](/platform/member/preferences#role).

Project tasks follow a rule of their own: every member who can open a project creates tasks in it and changes the tasks they created or that are assigned to them, while Editors and higher roles change every task. The project's settings, agents, and files stay with Editors. [Manage tasks on a project board](/platform/projects/tasks#who-can-create-and-change-tasks) lists what a Member can do with their own tasks.

These are role capabilities, not a promise that every record is visible. Conversation reads follow assignment: a person sees work assigned to them or their teams; unassigned conversations remain with Owners and Admins for triage. See [conversation routing](/platform/admin/governance/policies-and-limits#conversation-routing).

Audit-log viewing is restricted to Owners and Admins. Actions by other roles can still produce audit entries; producing an entry does not grant access to the log.

## Change a role or reset a password

Open the person's row menu, choose **Edit**, and change **Role**. Select **Save**, then check the role badge in the list. To restore a disabled member's access, explicitly select the role they should receive.

The edit dialog also changes the display name. Email is read-only. To set a replacement password, enable **Update password**, enter a password that meets the displayed requirements, and save. The member must choose a new password on their next sign-in; resetting the password signs the member out of all sessions. Use your organization's identity-checking process before resetting an account.

You cannot edit your own role through this menu, assign Owner through the role picker, or demote the last administrator. Existing Owners and the organization creator also have protected roles. If a change is refused, check the relevant account before trying a different role.

## Review a member's rights {#member-rights}

Four platform rights each let a member do one narrow thing that otherwise needs a higher role: **Call models over the API**, **Export notifications**, **Act for another member**, and **Publish skills to the organization**. To see what a person may do and why, open their row menu and choose **Rights**. Only Owners and Admins see this action, on every row, their own and the Owner's included.

The dialog lists the four rights. Each shows **Allowed** or **Not allowed**, the same answer Tale gives when the person uses the right, followed by the reasons behind it:

- **The organization's setting.** For **Call models over the API**, whether the [model endpoints for API keys](/platform/admin/governance/content-models#model-endpoints) are on. While they are off, no one has this right, whatever their role or grant; if the setting can't be read, the endpoints count as off. For **Publish skills to the organization**, the mode of the [skill sharing policy](/platform/admin/governance/policies-and-limits#skill-sharing); if the policy can't be read, **Owners and admins only** applies.
- **The role.** It carries the right, needs a grant for it, or, for **Disabled**, rules out every right, even a granted one.
- **The grant.** Who granted the right and when, and until when if it expires, or when an expired grant ended. A granter who has left the organization appears as **Former member**.
- **A team's grant.** If the right is granted to a [team](/platform/admin/governance/rights-and-qualifications#grant-a-right-to-a-team) an Owner or Admin added the person to: the team, who granted it and when, and until when, one line for each such team. The person holds the right through the team while they are in it. A team they belong to through your identity provider gives them no grant, so it is not listed.

Where the role needs a grant and neither the person nor one of their teams has one, the reasons say the right is not granted.

The switch beside each right is the person's own grant in the [register of rights and qualifications](/platform/admin/governance/rights-and-qualifications), not the verdict: it is on while they hold an active grant of their own. A switch can be on while the right shows **Not allowed**, for example while the model endpoints are off or when the member is **Disabled**, and a role that carries the right, or a team's grant, shows **Allowed** with the switch off. A team's grant has no switch here: revoke it under [Rights and qualifications](/platform/admin/governance/rights-and-qualifications), or remove the person from the team.

- To grant a right, turn its switch on. **Grant a right or qualification** opens with the person and the right already chosen: choose when it **Expires**, optionally note the **Evidence**, and select **Grant**.
- To revoke the grant, turn the switch off and confirm with **Revoke**.

Both work like granting and revoking under [Rights and qualifications](/platform/admin/governance/rights-and-qualifications), with the same checks, and every change is recorded in the register and in the audit log. The dialog reads the rights again each time you open it; if they can't be loaded, select **Try again**.

## Transfer ownership

An Owner can choose **Transfer ownership** from another member's row menu. Read the confirmation carefully: the selected person becomes Owner and the transferring Owner becomes Admin. Use this action for an ownership handover, not an ordinary role promotion.

## Remove or recover access

Use **Disabled** when access should stop while the membership remains. Use the row's **Delete** action to remove the membership from this organization. Removing it also deletes the separate sandbox workspaces of the [agent runs the person started](/platform/projects/tasks#agent-runs-a-member-starts), with their files; **Disabled** keeps them. It also revokes the [API keys](/platform/admin/api-keys#create-a-key-for-someone-else) an Owner or Admin made for the person here, and the keys the person made here for other members. Either way, reviews waiting on the person move on to the next [reviewer](/platform/projects/tasks#choose-an-owner-and-a-reviewer). After a removal, tasks keep the person's comments, activity and assignments, and read **Former member** where they named the person. Review shared work and team responsibilities first; removing membership is different from a [data subject erasure request](/platform/admin/governance/data-subject-requests).

If a member loses an authenticator or passkey, open **Edit** and use the relevant security controls. [Two-factor authentication](/platform/admin/two-factor-authentication) explains reset, recovery, and session consequences.
