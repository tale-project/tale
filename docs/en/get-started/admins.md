---
title: Set up a workspace for your team
description: Connect a model provider, add members, and verify the workspace with the access your team will use.
---

A usable workspace needs an organization, a working model provider, and accounts with the right access. Follow this sequence to get the team started, then configure the controls that match the work you plan to do.

## Before you begin

Use an Owner or Admin account on the correct instance. The first-run setup creates the initial account and organization. If you already see your organization in the dashboard, continue with its settings rather than creating another one.

Have the provider credential ready in your password manager. The provider must support the model and tasks you intend to use. [AI providers](/platform/admin/providers) explains credentials, catalogs, and agent runtimes.

## Connect a provider and test chat

<Steps>

<Step title="Add the credential">

Open **Settings > AI providers**, select **Add credential**, and choose the provider. Complete the fields for its supported authentication method and save. Use a descriptive credential name so another administrator can identify its purpose.

<Frame caption="Connected credentials make the provider’s models available to the workspace.">

![The AI providers settings page lists connected provider credentials.](/images/get-started/settings-providers.webp)

</Frame>

</Step>

<Step title="Check the model in a new chat">

Open **Chat**, start a new conversation, and select an available model. Send a self-contained prompt such as “Write a three-item meeting checklist.” Wait for the answer to finish. A saved credential alone does not prove that its account has access to the selected model.

If the model list is empty or the provider rejects the request, use the recovery steps in [AI providers](/platform/admin/providers).

</Step>

</Steps>

## Add people with the access they need

Open **Settings > Members** and select **Add member**. For a new account, the form sets an initial password; an existing account keeps its credentials. This flow does not send an invitation email. Follow [members and roles](/platform/admin/members-and-roles) for the fields and secure handover of the initial credentials.

<Frame caption="Review each member’s role before handing over access.">

![The Members page shows the people in the organization and the role assigned to each person.](/images/get-started/settings-organization-members.webp)

</Frame>

Choose the role for the job: Members use the workspace, Editors maintain shared content, Developers work on integrations and automations, and Admins manage the organization. Use the detailed permission table when the task crosses those boundaries. Teams and project sharing further determine which project work a person can access.

## Verify the team’s first workflow

Ask a teammate to sign in with their own account, send a message, and open the project they need. Check any shared source with that account too. Testing only as Owner can hide missing permissions or access that is broader than intended.

<Tip>

Start with one representative project and a small set of source documents. Confirm that people can find the work and that the intended accounts can access its files before importing a large library.

</Tip>

## Set the operating rules

Review [policies and limits](/platform/admin/governance/policies-and-limits), [audit logs](/platform/admin/governance/audit-logs), and [SSO](/platform/admin/enterprise-sso) as needed. Assign responsibility for provider credentials, access reviews, and responding to failed jobs. Self-hosted operators also need a tested [backup and restore process](/self-hosted/operate/backups-and-restore).
