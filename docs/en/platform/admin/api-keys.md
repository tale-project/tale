---
title: API keys
description: Create, verify, rotate, and revoke credentials for software that calls Tale.
---

Create an API key when a script or service needs to call Tale's REST API. A key you create for yourself belongs to you, not to the organization whose settings page created it: it acts as you, follows your current permissions, and works in every organization you are a member of. A REST call names the organization it addresses with the `X-Organization-Slug` header; a key whose holder belongs to one organization may omit it. Owners, Admins, and Developers manage their keys under **Settings > API > REST**, and so does a member an Admin granted a competence that is used with a key: **Call models over the API**, **Export notifications**, or **Act for another member**. Tale refuses anyone else a new key with `403 API_KEY_CREATE_FORBIDDEN`.

Owners and Admins can also create a key for another member, a team, a project, or the organization itself. Such a key works in that one organization only; [Create a key for someone else](#create-a-key-for-someone-else) explains what each one acts as and reaches. A member an Admin made a key for finds it under **Settings > API > REST** as well.

<Frame caption="Settings > API > REST — where keys are created, rotated, and revoked.">

![The Create API key dialog asks for a descriptive name, whom the key belongs to, and an expiry before a key is generated.](/images/get-started/settings-api-keys.webp)

</Frame>

## Create a key

1. Select **Create API key**.
2. Enter a **Key name** that identifies the caller, such as `Billing sync` or `Document import`.
3. As an Owner or Admin, choose under **Belongs to** whom the key is for. **You** is preselected; the other choices are described [below](#create-a-key-for-someone-else).
4. Choose **Expiration**: 7, 30, or 90 days, one year, a **Custom date**, or never. The form starts at 30 days and names, under the field, the day the key will expire. With **Custom date**, pick that day in the **Expiration date** calendar, from tomorrow up to one year ahead.
5. Create the key and copy its secret into the caller's approved secret store before closing the confirmation.

The complete secret is shown once. The table later shows only a masked fragment, whom the key belongs to, the day it expires, the creation date, and when it was last used. It lists your own keys and the keys an Admin made for you in this organization; Owners and Admins also see every key made here for a member, a team, a project, or the organization, though never the keys members made for themselves. Under **Belongs to**, a team's, a project's, or the organization's key shows the role it acts as, and a key made for a member shows who made it.

<Warning>

Anyone holding a key can act with its owner's permissions. Keep it out of source code, chat messages, screenshots, and logs. Use an account with only the access the integration needs.

</Warning>

## Create a key for someone else {#create-a-key-for-someone-else}

Owners and Admins choose under **Belongs to** whom a new key is for:

- **Another member**: the key acts as that member, with their current role and teams, in this organization only, and its usage counts toward their limits. You can choose a member whose role is below yours. The key works only while you are still an Owner or Admin above that member: it stops if you leave, lose that role, or the member reaches your role. The member gets a notification, sees the key in their list, and can revoke it. Hand the secret to them through a secure channel.
- **A team**, **A project**, or **The organization**: the key belongs to that team, project, or organization rather than to a person, and keeps working after you leave. It acts with the role you choose under **Acts as**: Member, Editor, or Developer, and Admin for the organization's key only. The role can't be above your own.

<Frame caption="A key for the organization itself acts with the role chosen under Acts as.">

![The Create API key dialog for a key that belongs to the organization itself, acting as a Developer and expiring in 30 days.](/images/platform/settings-api-keys-organization.webp)

</Frame>

| A key of | Reaches |
| --- | --- |
| A team | What a member of that team with the chosen role reaches: the team's projects, documents, and inbox, and everything the organization shares with all its members |
| A project | That project only: the routes under `/api/v1/projects/{projectId}`, `GET /api/v1/projects`, which lists only that project, `GET /api/v1/me`, and the model endpoints. Every other route answers `403 API_KEY_SCOPE_FORBIDDEN`. Through the chat assistant it reads its project's files and tasks, but none of the organization's contacts, products, websites, or inbox |
| The organization | What a member with the chosen role reaches across the organization |

These keys need no `X-Organization-Slug`; a header naming another organization answers `403 ORG_FORBIDDEN`. A key ends when what it belongs to does: when its member leaves the organization or its team or project is deleted, the key is revoked and the audit log records why; when the organization is deleted, its keys are deleted with it.

## Verify the caller

Follow the authenticated request in the [API quickstart](/get-started/developers). Confirm the returned identity and organization before starting a write or import. After an authenticated request, check **Last used** in the key table.

A successful authentication does not guarantee permission for every resource. Project access and the key owner's current role still apply. If a request fails, use the API's error response to distinguish an expired or revoked key from missing resource permissions.

## Rotate without an outage

1. Create a replacement key before the old one expires; the **Expires** column shows when that is.
2. Update the caller's secret store and restart or reload it as its configuration requires.
3. Run an authenticated request with the replacement and check that it works.
4. Revoke the old key only after every dependent caller has moved.

Tale does not automatically rotate keys. Key creation and revocation happen in this UI, not through `/api/v1`. A caller can inspect its key's name and expiry through `GET /api/v1/me` and alert the responsible person before expiration.

## Revoke a key

Open its row menu, select **Revoke key**, and confirm. Future requests with the key can no longer authenticate, calls to the model endpoints included; an answer that is already streaming finishes. Revocation cannot be undone; create a new key if you revoke the wrong one. Creating and revoking a key each leave a row in the audit log under **Settings > Governance > Logs**, in every organization you belong to.

An Owner or Admin can revoke any key made here for a member, a team, a project, or the organization, and a member can revoke the keys made for them. A member's own keys are theirs to revoke; to cut them off in this organization, disable or remove the member. Such a key is managed in its organization only: its creation and revocation are logged there, naming who made or revoked it.

Do not use an old **Last used** date as the only reason to revoke a key. A monthly job or a recovery process may legitimately be idle. Check the caller identified by the name first.

## Understand permissions and limits

Role changes take effect for existing keys on subsequent requests. Disabling the owner's membership removes their access; a key does not preserve the role it had when created. Losing the role or competence that let you create keys leaves the ones you hold in place: **Settings > API > REST** keeps listing them for you to revoke, but offers no new one.

Give an integration the narrowest access that works. A notification mirror, for example, does not need an Admin account: an Admin can grant an ordinary member the `tale:notifications.export` capability, which permits that export and none of the other rights of the Admin role. The grant applies only in that organization, can expire, and ends when the member is removed. Grant it under [Competences](/platform/admin/governance/competences), where an integration that relays people's answers and review decisions gets `tale:rest.act-as` the same way; [Delegate the export without an Admin role](/develop/api-reference#delegate-the-export-without-an-admin-role) covers the API side.

REST rate limits apply to the authenticated key holder. Several keys owned by the same person do not provide separate rate-limit allowances, while a key an Owner or Admin made for a member, a team, a project, or the organization has an allowance of its own. See [Rate limits](/develop/rate-limits). A [budget rule](/platform/admin/governance/policies-and-limits) can additionally cap what requests authenticated with one key may spend: their usage counts toward the key, and a send or a model call over the cap is refused with `429 BUDGET_EXCEEDED`. Automation runs started with the key count toward it as well, alongside the personal limits of the member the key acts for. A key made for a member counts toward that member's limits, like their own key. A team's, a project's, or the organization's key spends under its own name: no personal, role, or default limit applies to it, but the organization's limits and any rule for the key do, a team's key also counts toward, and is held to, its team's limit, and a project's key its project's. Usage analytics lists such a key as a row of its own, never as an active user. [How usage is counted](/platform/admin/governance/usage-attribution) has the full rule.

A key can also call the organization's models from tools such as opencode or Claude Code, through the [model endpoints](/develop/use-tale-from-your-editor#model-endpoints), once an Admin turns them on under [Models](/platform/admin/governance/content-models#model-endpoints). Its holder must be an Owner, Admin, or Developer, or hold **Call models over the API**. Those calls count toward the key's budget rules like its chat messages, and they appear as **Direct API** in usage analytics under the person and the key.

API keys authenticate software calling Tale. [Connector credentials](/platform/admin/connectors) serve the other direction: they let Tale call an external service. [Use Tale from your editor or a script](/develop/use-tale-from-your-editor) shows where a key goes in opencode, Claude Code, and a shell script.
