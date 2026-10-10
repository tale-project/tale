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

<Frame caption="Governance > Logs: the Audit logs tab narrowed to the Member category. Clear all removes the filter.">

![The Logs page with the Audit logs tab filtered to the Member category, listing eleven events in which Alex Rivera added members, created three teams, and added a member to each team, every row showing its resource, target, category, and a Success status.](/images/platform/governance-audit-logs.webp)

</Frame>

## Read an event

| Field | What to look for |
| --- | --- |
| Timestamp | When Tale recorded the action. |
| Action | The operation that was attempted or completed. Some newer actions appear by their technical name. |
| User | The person or system actor responsible. For a write made with an API key, User names the key’s maker and Actor type is API. If the key acts for a member, Metadata keeps that member’s ID in `keyAttribution.subjectUserId`. JSON exports also retain the key ID (`apiKeyId`); CSV omits key and subject metadata. |
| Source and client | Only on an action a coding agent took through the [MCP endpoint](/develop/mcp-endpoint). **Source** shows Coding agent, and **Client** names the agent's app when the app names itself on every call, as apps on MCP revision 2026-07-28 do; an app on an earlier revision names itself only when it connects, so its events show no **Client**. **User** names the key’s maker; the member it acts for is recorded in Metadata. |
| Resource and target | The kind of item and the particular record affected. |
| Category | The grouping used by the filter. |
| Status | Success, failure, or denied. |
| Detail view | Available previous/new state, changed fields, metadata, and error information. Not every event has every field. |

Treat the log as evidence of the events it records. It is not a complete copy of every conversation, provider response, or external service's activity.

## Choose the right tab

**Audit logs** contains individual events; the table loads more as you scroll, and its footer states how many events are loaded so far, so a count is never the whole history until the footer says so. **Sign-in blocks** helps investigate authentication lockouts. **Activity logs** summarizes activity and outcomes over a period: the period chosen in its **Filter** (7, 30, or 90 days) is named above the totals, and every number on the tab covers that period only. **Error logs** focuses on failures; its category filter helps narrow the investigation.

When a member cannot sign in, begin with the sign-in blocks and the [account security guidance](/platform/admin/two-factor-authentication). When a configuration changed unexpectedly, use the audit event and its detail view.

## Export results

Set the category filter, then open **Export** and choose CSV or JSON. CSV provides flat columns for spreadsheets, including UTC timestamps, actor identifiers, resource identifiers, status, and errors. JSON preserves the fuller event objects, including available change payloads and integrity hashes.

Exports honor the category filter and contain at most 10,000 rows, newest first. They are generated on the server and downloaded through a temporary link. A filtered or capped export is a selection of evidence; it is not necessarily the entire audit history or a complete hash chain.

## Retention and integrity

Use **Verify now** in **Chain integrity** to check the stored audit chain. The panel shows its status and the latest automated check. If a check reports a break, preserve the reported details and investigate with the deployment operator before relying on that segment of history.

A successful check covers the retained records it examined; it does not establish an independently signed origin for the history. The [operator integrity guide](/self-hosted/operate/security/audit-log-integrity) explains the checks and their limits.

Hash chaining helps detect changes to stored records; it does not prove that every possible action was logged. Audit retention is configurable under [Policies and limits](/platform/admin/governance/policies-and-limits). Check the active policy and deployment bounds instead of assuming a fixed retention period. Recoverable audit records can appear in [Trash](/platform/admin/governance/trash); permanent cleanup limits the history available here.

Scheduled retention cleanup records each of its runs here as system events in the **Data** category: when the run started, how many records each category deleted, and whether the run completed or failed.
