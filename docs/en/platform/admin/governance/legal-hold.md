---
title: Legal hold
description: Preserve a person's or organization's data, organize holds by matter, and review release requests.
---

A legal hold preserves covered data while a matter is open. Admins and Owners manage holds under **Settings > Governance > Legal hold**. Place the hold while the data still exists: it cannot recover records that were already permanently deleted.

<Frame caption="Governance > Legal hold — the active-holds table with the Place legal hold action above the dual-control release-requests queue.">

![The Legal hold governance page showing one active hold — a User hold on marta.vogel, placed by Alex Rivera under the Northstar contract matter — beside a Place legal hold button, above the Pending approval and Approved release-request queues, both reading No release requests.](/images/platform/governance-legal-hold.webp)

</Frame>

## Place a hold

1. Select **Place legal hold**.
2. Choose the target: a user as custodian, or the whole organization. For a user hold, select the intended member.
3. Enter a reason that lets another admin understand what must be preserved. Link the hold to a matter if you are tracking a case.
4. Confirm, then check the target and reason in **Active holds**.

A placed hold takes effect immediately. Covered data is protected from retention and erasure; attempts to delete held content are refused. Use your organization's preservation process to decide the correct scope.

## Organize holds by matter

Use **Create matter** to group related holds under a case name and number. The matter's linked-hold count helps you check that the intended custodians are covered.

Closing a matter requests the release of its linked holds. It does not release them immediately: each request still needs the separate review below.

## Release a hold

1. On the active hold, choose **Request release** and record why preservation is no longer needed.
2. A different admin reviews the request and chooses **Approve** or **Reject**. The requesting admin cannot approve their own release.
3. After approval, check the cooldown shown in **Release requests**. The hold remains effective while the request awaits that cooldown.
4. Check **Release history** for the completed outcome and **Active holds** to confirm which holds remain.

Placing a hold takes one admin; releasing it uses two-person review and a delay. Approval is therefore not the same as completed release.

## Understand blocked deletion

A hold can block a person's erasure request, deletion of their covered chats or documents, and deletion of a folder that contains held files. Any active organization or member hold also prevents deletion of the organization itself.

If a deletion fails, inspect the relevant hold instead of repeatedly trying the action. Releasing one hold does not remove another overlapping hold, and release allows the applicable retention or erasure process to continue.

## Review related requests

Use [Data subject requests](/platform/admin/governance/data-subject-requests) to inspect an erasure receipt blocked by a hold, and [audit logs](/platform/admin/governance/audit-logs) to investigate recorded hold actions. The [retention policy](/platform/admin/governance/policies-and-limits) determines normal cleanup after preservation no longer applies.
