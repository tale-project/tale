---
title: Organization settings
description: Rename the organization, choose the language its agents fall back to, copy the organization ID, and delete the organization.
---

**Settings > Organization** shows the organization you have open: its name, its agents' default language and its ID under **Organization details**, and, for Owners, a **Danger zone** for deleting it. Owners and Admins can open the page. Other roles don't see **Organization** in the settings menu, and a link to the page shows them **You need Admin permissions to access organization settings.**

## Rename the organization {#rename-the-organization}

Change **Organization name**, then select **Save** in the settings header. The name and **Default language (for agents)** are saved together; **Discard** brings both back to their saved values, and a save that fails shows **Couldn't update organization**.

The name can't be empty: Tale drops spaces at either end and refuses a blank name with **Organization name is required** under the field. Unlike the name of a new organization, it may contain any characters, not only letters, digits, spaces, hyphens and underscores.

The new name appears wherever Tale names the organization, for example in the organization switcher of your profile menu and at the end of the browser tab's title. Renaming doesn't change the organization's slug, which was set when the organization was created, so WebDAV addresses and scripts that send the slug in `X-Organization-Slug` keep working.

## Choose the agents' default language {#default-language}

Select **English**, **Deutsch** or **Français** under **Default language (for agents)**, then select **Save**. An organization created in the app starts with the interface language of the person who created it, or with English when that language is not one of these three.

Tale uses this language in these places:

- Project agents and the agent steps of automations are instructed to keep a task in the language of its title and description. When those don't settle the language, or a run has no task, they are told to use this one. [Delegate a task to an agent](/platform/projects/task-automation#prepare-and-start-the-task) explains the rule.
- When Tale sets up the [standard agent](/platform/projects/project-agents#standard-agent) in a project, it names the agent in this language, for example **Standard-Agent** for German. Changing the language later doesn't rename it.
- Emails about notifications are written in this language, whatever language the recipient uses in Tale. A message an automation sends to members ([`notify.member`](/platform/automations/notify-members)) also names the automation in this language, if the automation has a name in it.
- The API's notification export uses it when a request names no `locale` ([Select the recipient and stream](/develop/api-reference#select-the-recipient-and-stream)).

The setting doesn't change anyone's interface language, which each person chooses in their profile menu ([Switch language or workspace](/platform/member/preferences#switch-language-or-workspace)). The chat assistant doesn't follow this setting either.

## Copy the organization ID {#organization-id}

**Organization ID** shows the identifier Tale gave the organization when it was created; renaming doesn't change it. Select the field to copy the ID. A check mark confirms the copy.

Use the ID where Tale asks for the organization ID or `orgId`:

- in calls to `/api/app` made with a signed-in session, such as registering an application that [signs in with Tale](/develop/api-reference#sign-in-to-an-application-with-tale);
- as `--org` when the `tale` CLI [configures the platform](/self-hosted/install/cli-install#configure-the-platform).

The same ID follows `/dashboard/` in the address of the organization's pages, and `GET /api/v1/me` returns it as `organization.id`. The REST API identifies the organization by its slug instead: send the slug in `X-Organization-Slug`, never the ID. [Identify the account and organization](/get-started/developers#identify-the-account-and-organization) shows how a script finds the slug; you can also copy it from **Organization slug** under **Settings > API > MCP**.

## Delete the organization {#delete-the-organization}

<Warning>

Deleting the organization removes everything in it, for every member. It can't be undone.

</Warning>

Only Owners see **Danger zone** and can delete the organization; an Admin who needs it deleted asks an Owner. An organization whose slug is `default` has no **Danger zone**: the deployment keeps its platform-wide defaults under that slug, so Tale never deletes it.

1. Check **Organization name** to make sure you have the right organization open: the page always belongs to the organization you are in.
2. Under **Danger zone**, select **Delete organization**.
3. Read the dialog. It names the organization and says what deletion removes.
4. Type the name the dialog shows into **Type the organization name to confirm**. Capitals count; spaces at either end don't. The dialog's **Delete organization** stays disabled until the name matches.
5. Select **Delete organization**. While Tale deletes, the button shows a spinner and the dialog can't be closed.

Tale confirms with **Organization deleted** and takes you to another organization you belong to. If it was your only one, you land on the page for creating an organization. On a deployment that limits who may create organizations, that page says **You cannot create an organization on this deployment. Contact the operator to request a workspace.**

### What deletion removes {#what-deletion-removes}

The organization goes with its teams, pending invitations, projects, tasks, documents, conversations, agents, automations and their runs, AI providers, connectors and their credentials, connected coding agents, the applications registered to sign in with Tale, and all of the organization's [sandboxes with their files](/platform/admin/sandboxes#explain-why-a-workspace-disappeared). The API keys made here for a member, a team, a project or the organization go too; keys that members made for themselves stay theirs. Members keep their Tale accounts and their other organizations; only their membership in this one ends.

Uploaded files, the knowledge index and the organization's configuration go in a cleanup that follows the deletion. It empties the file storage and the knowledge database the organization uses at that moment. If the organization was connected to a bucket or knowledge database of its own under **Settings > Data residency**, files that were never moved there and knowledge indexed before the switch stay in the earlier storage ([Choose and move data stores](/self-hosted/configuration/data-residency)).

Until the cleanup has finished, a new organization can't take the name the deleted one was created with, even in different capitals: Tale refuses it with **That name is already taken. Pick a different one.** Try again later.

The audit log stays: Tale keeps its entries, including one that records the deletion, but nobody can open them in the app once the organization is gone.

### When Tale refuses the deletion {#when-deletion-is-refused}

A refused deletion changes nothing. The organization stays as it was, the dialog stays open, and **Couldn't delete organization** gives the reason:

| Reason | What to do |
| --- | --- |
| **An active legal hold is preserving this organization's data. Release every hold under Governance > Legal hold, then try again.** | A hold on the whole organization or on any of its members blocks the deletion. Release each one under **Settings > Governance > Legal hold**; a release needs a second admin's approval and a cooldown. Try again once **Active holds** reads **No active legal holds**. [Understand blocked deletion](/platform/admin/governance/legal-hold#understand-blocked-deletion) explains the rule. |
| **Automation runs are on hold because their earlier external actions have not been verified. Your organization was preserved. A stop request does not release these holds.** | Some automation runs were [held after an upgrade](/platform/automations/execution-logs#a-run-held-after-an-upgrade). These holds currently have no release action, so the organization can't be deleted while one remains. |
| **The confirmation doesn't match the organization name. Reload the page and try again.** | The organization's name changed after the page loaded: someone renamed it in another window, or you saved a new name on this page. Reload the page, then type the name the dialog shows. |
