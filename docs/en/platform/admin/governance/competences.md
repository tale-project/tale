---
title: Competences
description: Give a member or a team one narrow right, or a member a qualification, without an Admin role, and revoke it when it is no longer needed.
---

Use **Settings > Governance > Competences** as an Admin or Owner to keep the organization's competence register. A competence is one of two things:

- A **platform capability** lets a member do one narrow thing that otherwise needs a higher role. Grant it to the account behind an integration instead of making that account an Admin, which would also let it manage members, single sign-on and passwords.
- A **qualification** is a name your organization's review policy can require of the person who approves a review.

You grant a competence to one member, or a platform capability to a [team](#grant-a-capability-to-a-team). A grant applies in this organization only. Tale records every grant and revocation in the audit log, and removing a member from the organization revokes their grants.

## Platform capabilities

| Capability                                             | What it allows                                                                                                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Export notifications** (`tale:notifications.export`) | Read the notifications another member can see through the REST API, so another application can mirror them.                                               |
| **Act for another member** (`tale:rest.act-as`)        | Name the member an API call answers a question or decides a review for. The task timeline and the audit log then show that person instead of the API key. |
| **Publish skills to the organization** (`tale:skills.publish`) | Share a skill with the whole organization even when the [skill sharing policy](/platform/admin/governance/policies-and-limits#skill-sharing) reserves that for Editors or admins. |
| **Call models over the API** (`tale:models.api`) | Call the organization's models from one's own tools with a personal API key, through the [model endpoints](/develop/use-tale-from-your-editor#model-endpoints), once the organization turns them on. It also opens **Settings > API** with its **REST** and **Models** tabs, to create the key and read the setup. |

Owners and Admins have all four through their role, and Developers also have **Call models over the API** through theirs. Any other member needs the capability granted here, for example a Developer account whose API key an integration uses for an export. Without it, the REST API answers an export or an `actor` with `403 ROLE_FORBIDDEN`, and the model endpoints answer `403 MODEL_API_FORBIDDEN`. The [API reference](/develop/api-reference#name-the-member-the-gesture-is-for) describes the export and `actor` requests.

**Export notifications**, **Act for another member**, and **Call models over the API** are used with a personal API key, so each also lets its holder create one under **Settings > API > REST**. The key acts with the holder's own role; the competence adds only its own right.

**Publish skills to the organization** matters only while the skill sharing policy reserves organization-wide skills. Under **Editors and above**, Editors and Developers already have it through their role. Without it, a member can share skills with their own teams only, and the skill editor, uploads, and the REST API refuse an organization-wide skill with `403 SKILL_PUBLISH_FORBIDDEN`.

**Call models over the API** takes effect only once the organization turns on the model endpoints under [Models](/platform/admin/governance/content-models#model-endpoints). While they are off, the grant dialog says so when you choose this capability and links there with **Open model access**; you can still grant it. A member who holds it can open **Settings > API** with its **REST** and **Models** tabs to create a personal key and copy the setup; the **MCP** and **WebDAV** tabs stay with Owners, Admins, and Developers. Once the grant is revoked, Tale refuses the member's next model call.

## Grant a competence

1. Select **Grant competence**.
2. Under **Grant to**, choose **A member** and then the **Member**, or **A team** and then the **Team**.
3. Choose the **Competence**: a platform capability, or **Qualification**, then type the **Qualification name** your review policy uses. Names that start with `tale:` are reserved for platform capabilities. A team can hold a platform capability only.
4. Choose when it **Expires**: **Never**, **In 30 days**, **In 90 days** or **In 1 year**.
5. Optionally note the **Evidence**: why the member holds it, such as a certificate, a ticket or the system it serves. It stays in the register.
6. Select **Grant**.

The grant applies to the member's next request, so an integration does not need a restart. A member or a team holds each competence once at a time: to change its expiry or evidence, revoke the grant and grant it again. If they already hold it, the dialog says so and grants nothing.

## Grant a capability to a team

A grant to a team gives a platform capability to the team's members while they are in the team, so you do not grant it to each of them:

- A person an Owner or Admin adds to the team under [**Settings > Teams**](/platform/admin/teams) holds it from their next request, without another grant.
- A person who leaves the team, or is removed from the organization, no longer holds it through the team.
- Revoking the team's grant ends it for all of the team's members. Deleting the team revokes the team's grants.

A member who also holds the capability through a grant of their own, or through their role, keeps it.

Only a membership an Owner or Admin made under **Settings > Teams** carries the team's grants. A membership your identity provider makes through [SSO group sync or SCIM](/platform/admin/enterprise-sso) carries none, so the provider never confers a right this way. A team the provider manages shows **Synced from your identity provider** in the grant dialog and cannot be chosen; grant to each member instead, or to a team an Admin manages.

A team holds platform capabilities only. Grant a qualification to each member who needs it, because a review policy asks it of the person who approves.

## Revoke a competence

Select **Revoke** on the row and confirm with **Revoke**. The member loses the competence right away; for a team's grant, so do the team's members, unless they hold it through a grant of their own. The grant stays in the register as history with the status **Revoked** and the revocation date; point at the date to see who revoked it or why.

## Read the register

The list opens on **Active** grants. Use **Filter > Status** to include **Expired** and **Revoked** grants, or select **Clear all** to see every grant.

| Status      | Meaning                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Active**  | The member holds the competence. The line below shows its expiry date, or **No expiry**.                                  |
| **Expired** | The expiry date has passed, shown below the status. Grant it again if the member still needs it.                          |
| **Revoked** | An Admin or Owner revoked it, a new grant replaced it after it expired, its member left the organization, or its team was deleted. The revocation date is shown below the status. |

A team's grant names the team, marked **Team**; once the team is deleted it reads **Deleted team**. Every grant and revocation of a team's grant is recorded in the [audit log](/platform/admin/governance/audit-logs) with the team's ID and name.

Removing a member revokes every active grant they hold — capabilities and qualifications alike — so a re-added member starts without them. A revoked grant whose holder has left the organization names them **Former member**. The register lists every active and expired grant, and the 1,000 most recent revoked ones as history.

<Tip>

An integration can check its own key with `GET /api/v1/me`: `capabilities.actAs`, `capabilities.notificationExport`, `capabilities.skillPublish`, and `capabilities.modelApi` say whether the key may use each capability, through its role or a grant; `capabilities.modelApi` also needs the model endpoints turned on.

</Tip>
