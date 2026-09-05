---
title: Audit logs
description: The chronological log of who-did-what across your organisation — sign-ins, role changes, provider edits, agent edits.
---

The audit log is the immutable record of every consequential action inside your organisation. Every sign-in, role change, provider edit, agent save, workflow run, and sandbox invocation lands here with the actor, the resource, the before/after state, and the timestamp. Admins and Owners read this when an audit asks who touched a resource and when, when a compliance officer needs an export, or when something goes sideways and the question is _who changed what at 03:14_.

This page is the reference for the columns, the filters, the categories, and the export formats. The retention window for audit rows is set on the same Governance area under retention policy — keep it long enough to satisfy your compliance requirements before rows roll off.

## A worked filter

To find the moment a member's role was changed, open **Settings > Governance > Logs** and set the **Category** filter to **Member** — the user and target columns identify the people involved. Each row expands to the full payload — previous state, new state, changed fields, the actor type (user, system, API, workflow). Export the filtered set as CSV or JSON from the toolbar above the table.

## The columns

| Name      | Type     | Required | Description                                                                               |
| --------- | -------- | -------- | ----------------------------------------------------------------------------------------- |
| Timestamp | ISO 8601 | yes      | Server time the action committed.                                                         |
| Action    | string   | yes      | The semantic action — `update_member_role`, `provider_created`, `agent_saved`.            |
| User      | string   | yes      | Display name of the actor; `System`, `API`, or `Workflow` when the actor is not a person. |
| Resource  | string   | yes      | The resource type the action touched — `agent`, `provider`, `member`, `workflow`.         |
| Target    | string   | no       | The specific resource the action touched, by name or id.                                  |
| Category  | enum     | yes      | Auth, Member, Data, Connector, Automation, Security, Admin, AI, Skill, Agent.             |
| Status    | enum     | yes      | Success, Failure, Denied.                                                                 |
| Error     | string   | no       | The error message when the action failed or was denied.                                   |

The diff between previous and new state, the changed-field list, and any AI usage metadata travel with the row and open in its detail view rather than as columns.

## Filters

The audit table carries one filter — **Category**, single-select. Both the filter and the active tab round-trip through the URL, so a saved link reopens the same view. The page splits into four tabs: **Audit logs** (the table this page describes), **Sign-in blocks**, **Activity logs** (a per-period summary with success, failure, and denied counts), and **Error logs**; the category filter applies on the audit and error tabs.

## Exporting

Two export formats ship: CSV for spreadsheets and JSON for downstream systems. Both honour the active category filter — what you export is what you see. Set the filter you want (the worked filter above is the pattern), then choose CSV or JSON from the toolbar above the table. The export is built server-side — up to 10,000 rows — stored with your organisation's files, and handed to the browser as a short-lived download link.

The CSV arrives as `audit-logs-<timestamp>.csv`, one row per action, with a flat column per field; timestamps are ISO 8601 in UTC and any value containing a comma is quoted:

```csv
timestamp,action,category,actorEmail,actorId,actorType,actorRole,resourceType,resourceId,resourceName,status,errorMessage
2026-01-14T03:14:07.000Z,member.role_changed,Member,admin@acme.example,usr_8f3a,user,owner,member,usr_2b91,jordan@acme.example,success,
2026-01-14T03:15:22.000Z,provider.updated,Provider,admin@acme.example,usr_8f3a,user,owner,provider,prov_openai,OpenAI,success,
```

The JSON export (`audit-logs-<timestamp>.json`) carries the same rows as full objects plus the fields CSV flattens away — the `previousState`/`newState` diff and the per-row `integrityHash`. Reach for JSON when a downstream system needs the before/after payload or has to re-verify each row against the SHA-256 chain (see [Retention and integrity](#retention-and-integrity)); reach for CSV when a person opens it in a spreadsheet.

## Retention and integrity

Audit rows are immutable: edits and deletes are themselves audited, and the row schema carries an integrity hash you can verify against the export. A scheduled daily check walks the hash chain server-side, so tampering or an out-of-band deletion surfaces even when no admin runs the manual check. A failed check raises a critical in-app notification to the organisation's admins and fans out to Slack when a Slack notification channel is configured. Admins can verify the chain on demand from the **Chain integrity** panel at the top of this page — it shows the current status, the last automated check time, and a **Verify now** button — and a failed check's notification deep-links to the flagged row so an admin lands on the break instead of the top of the log. Retention defaults to two years and is configurable on the retention policy page — between one year, the compliance floor, and ten. Rows that age out are removed by the next cleanup pass — there is no soft-delete window for audit data.

## Where this fits

The audit log is the read side of every other governance feature: legal hold names the holds it placed, data subject requests log every cascade step. When a question starts with _who, when, what_, the audit log is the answer. The companion page is the [retention policy](/platform/admin/governance/policies-and-limits) — it controls how long these rows stay before cleanup removes them.
