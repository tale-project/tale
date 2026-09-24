---
title: Competences
description: Give a member one narrow right or a qualification without an Admin role, and revoke it when it is no longer needed.
---

Use **Settings > Governance > Competences** as an Admin or Owner to keep the organization's competence register. A competence is one of two things:

- A **platform capability** lets a member do one narrow thing that otherwise needs an Admin role. Grant it to the account behind an integration instead of making that account an Admin, which would also let it manage members, single sign-on and passwords.
- A **qualification** is a name your organization's review policy can require of the person who approves a review.

A grant applies in this organization only. Tale records every grant and revocation in the audit log, and removing a member from the organization revokes their grants.

## Platform capabilities

| Capability                                             | What it allows                                                                                                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Export notifications** (`tale:notifications.export`) | Read the notifications another member can see through the REST API, so another application can mirror them.                                               |
| **Act for another member** (`tale:rest.act-as`)        | Name the member an API call answers a question or decides a review for. The task timeline and the audit log then show that person instead of the API key. |

Owners and Admins have both through their role. Any other member, for example a Developer account whose API key an integration uses, needs the capability granted here. Without it, the REST API answers such a request with `403 ROLE_FORBIDDEN`. The [API reference](/develop/api-reference#name-the-member-the-gesture-is-for) describes both requests.

## Grant a competence

1. Select **Grant competence**.
2. Choose the **Member**.
3. Choose the **Competence**: a platform capability, or **Qualification**, then type the **Qualification name** your review policy uses. Names that start with `tale:` are reserved for platform capabilities.
4. Choose when it **Expires**: **Never**, **In 30 days**, **In 90 days** or **In 1 year**.
5. Optionally note the **Evidence**: why the member holds it, such as a certificate, a ticket or the system it serves. It stays in the register.
6. Select **Grant**.

The grant applies to the member's next request, so an integration does not need a restart. A member holds each competence once at a time: to change its expiry or evidence, revoke the grant and grant it again. If the member already holds it, the dialog says so and grants nothing.

## Revoke a competence

Select **Revoke** on the row and confirm with **Revoke**. The member loses the competence right away. The grant stays in the register as history with the status **Revoked** and the revocation date; point at the date to see who revoked it.

## Read the register

The list opens on **Active** grants. Use **Filter > Status** to include **Expired** and **Revoked** grants, or select **Clear all** to see every grant.

| Status      | Meaning                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Active**  | The member holds the competence. The line below shows its expiry date, or **No expiry**.                                  |
| **Expired** | The expiry date has passed, shown below the status. Grant it again if the member still needs it.                          |
| **Revoked** | An Admin or Owner revoked it, or a new grant replaced it after it expired. The revocation date is shown below the status. |

A grant held by someone who has left the organization names them **Former member**.

<Tip>

An integration can check its own key with `GET /api/v1/me`: `capabilities.actAs` and `capabilities.notificationExport` say whether the key holds each capability.

</Tip>
