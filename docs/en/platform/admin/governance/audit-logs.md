---
title: Audit logs
description: Find recorded organization changes, inspect event details, export results, and check the audit chain.
---

Open **Settings > Governance > Logs** as an Admin or Owner to investigate recorded actions in your organization. Start with the event and time you need, then inspect its actor, target, result, and available change details.

## Find a change

1. Select **Audit logs** and open **Filter**.
2. Choose a category relevant to the action, such as member changes, security, or data.
3. Find the event by timestamp, action, and target. Open its row to inspect the details.
4. Check the status before interpreting the event: an attempted action marked denied or failed does not establish that the change succeeded.

The active tab and category are reflected in the URL, so you can bookmark the view. Access still depends on your organization permissions.

## Read an event

| Field | What to look for |
| --- | --- |
| Timestamp | When Tale recorded the action. |
| Action | The operation that was attempted or completed. Some newer actions appear by their technical name. |
| User | The person or system actor responsible for the action. |
| Resource and target | The kind of item and the particular record affected. |
| Category | The grouping used by the filter. |
| Status | Success, failure, or denied. |
| Detail view | Available previous/new state, changed fields, metadata, and error information. Not every event has every field. |

Treat the log as evidence of the events it records. It is not a complete copy of every conversation, provider response, or external service's activity.

## Choose the right tab

**Audit logs** contains individual events. **Sign-in blocks** helps investigate authentication lockouts. **Activity logs** summarizes activity and outcomes over a period. **Error logs** focuses on failures; its category filter helps narrow the investigation.

When a member cannot sign in, begin with the sign-in blocks and the [account security guidance](/platform/admin/two-factor-authentication). When a configuration changed unexpectedly, use the audit event and its detail view.

## Export results

Set the category filter, then open **Export** and choose CSV or JSON. CSV provides flat columns for spreadsheets, including UTC timestamps, actor identifiers, resource identifiers, status, and errors. JSON preserves the fuller event objects, including available change payloads and integrity hashes.

Exports honor the category filter and contain at most 10,000 rows, newest first. They are generated on the server and downloaded through a temporary link. A filtered or capped export is a selection of evidence; it is not necessarily the entire audit history or a complete hash chain.

## Retention and integrity

Use **Verify now** in **Chain integrity** to check the stored audit chain. The panel shows its status and the latest automated check. If a check reports a break, preserve the reported details and investigate with the deployment operator before relying on that segment of history.

A successful check covers the retained records it examined; it does not establish an independently signed origin for the history. The [operator integrity guide](/self-hosted/operate/security/audit-log-integrity) explains the checks and their limits.

Hash chaining helps detect changes to stored records; it does not prove that every possible action was logged. Audit retention is configurable under [Policies and limits](/platform/admin/governance/policies-and-limits). Check the active policy and deployment bounds instead of assuming a fixed retention period. Recoverable audit records can appear in [Trash](/platform/admin/governance/trash); permanent cleanup limits the history available here.
