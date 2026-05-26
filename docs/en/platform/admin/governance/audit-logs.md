---
title: Audit logs
description: The chronological log of who-did-what across your organisation — sign-ins, role changes, provider edits, agent edits, run-code invocations. Admins and Owners read this when an audit asks who touched a resource and when.
---

The audit log is the immutable record of every consequential action inside your organisation. Every sign-in, role change, provider edit, agent save, workflow run, and sandbox invocation lands here with the actor, the resource, the before/after state, and the timestamp. Admins and Owners read this when an audit asks who touched a resource and when, when a compliance officer needs an export, or when something goes sideways and the question is _who changed what at 03:14_.

This page is the reference for the columns, the filters, the categories, and the export formats. The retention window for audit rows is set on the same Governance area under retention policy — keep it long enough to satisfy your compliance requirements before rows roll off.

## A worked filter

To find the moment a member's role was changed, open **Settings > Governance > Audit logs**, set the **Category** filter to **Member**, and search for the actor or the target by name. Each row expands to the full payload — previous state, new state, the IP if the request was over the wire, the actor type (user, system, API, workflow). Export the filtered set as CSV or JSON from the toolbar above the table.

## The columns

| Name           | Type     | Required | Description                                                                               |
| -------------- | -------- | -------- | ----------------------------------------------------------------------------------------- |
| Timestamp      | ISO 8601 | yes      | Server time the action committed.                                                         |
| Action         | string   | yes      | The semantic action — `update_member_role`, `provider_created`, `agent_saved`.            |
| User           | string   | yes      | Display name of the actor; `System`, `API`, or `Workflow` when the actor is not a person. |
| Resource       | string   | yes      | The resource the action touched — `agent`, `provider`, `member`, `workflow`.              |
| Category       | enum     | yes      | Auth, Member, Data, Integration, Workflow, Security, Admin, AI, Skill, Agent.             |
| Status         | enum     | yes      | Success, Failure, Denied.                                                                 |
| Changed fields | JSON     | no       | The diff between previous and new state for update actions.                               |

## Filters

Filter by date range, category, status, actor, resource, or free-text search across action names. Combine filters — a date range plus the **Security** category plus **Denied** status surfaces the failed sign-in attempts in a window. Filter state is reflected in the URL, so a saved link reopens the same view.

## Exporting

Two export formats ship: CSV for spreadsheets and JSON for downstream systems. Both honour the active filters — what you export is what you see. Large exports stream as a download; the toolbar reports progress and reports completion with the file size and row count.

## Retention and integrity

Audit rows are immutable: edits and deletes are themselves audited, and the row schema carries an integrity hash you can verify against the export. Retention defaults to 90 days and is configurable on the retention policy page (30 to 365 days). Rows that age out are removed by the next cleanup pass — there is no soft-delete window for audit data.

## Where this fits

The audit log is the read side of every other governance feature: legal hold names the holds it placed, data subject requests log every cascade step, the run-code policy logs the URLs each sandbox tried to reach. When a question starts with _who, when, what_, the audit log is the answer. The companion page is the [retention policy](/platform/admin/governance/policies-and-limits) — it controls how long these rows stay before cleanup removes them.
