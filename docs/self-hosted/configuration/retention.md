---
title: Retention configuration
description: Configure how long conversations, files, audit records, and executions are kept.
---

Tale has a single, central retention configuration that applies across every data domain — chat conversations, uploaded files, audit logs, workflow executions, and analytics records. The defaults are reasonable for most deployments; tune them when compliance, cost, or privacy rules require different settings.

Retention can be configured in two places:

- **Environment variables** — the floor, set by the operator deploying Tale. Users cannot relax these.
- **Governance UI** — per-organisation overrides within the environment floor. See [Governance](/platform/admin/governance).

## Environment variables

These apply to every organisation on the deployment. All values are in days.

| Variable                             | Default | Governs                                                 |
| ------------------------------------ | ------- | ------------------------------------------------------- |
| `TALE_RETENTION_CONVERSATIONS_DAYS`  | `365`   | Chat conversations and their messages.                  |
| `TALE_RETENTION_FILES_DAYS`          | `365`   | Uploaded files attached to chat or the knowledge base.  |
| `TALE_RETENTION_AUDIT_DAYS`          | `730`   | Audit log entries.                                      |
| `TALE_RETENTION_EXECUTIONS_DAYS`     | `90`    | Workflow execution detail. Summary rows kept 365 days.  |
| `TALE_RETENTION_ANALYTICS_DAYS`      | `395`   | Per-request usage analytics rows.                       |
| `TALE_RETENTION_DELETION_GRACE_DAYS` | `30`    | Soft-deleted records (trash) before permanent deletion. |

The deletion job runs nightly at 03:00 UTC. Set `TALE_RETENTION_DISABLED=true` to suspend deletion entirely — useful for debugging, not recommended in production.

## Ordering and overrides

The environment variable is the upper bound. A governance policy in the admin UI can only set the org-level retention **equal to or lower than** the environment value. This lets operators enforce a compliance floor while still allowing privacy-sensitive organisations to keep less.

If a governance policy requests a higher retention than the environment allows, the request is rejected with a clear error.

## Legal hold

When an audit record is tagged for legal hold, retention is suspended for the matching conversations, files, and executions until the hold is lifted. Legal hold is managed in Governance and logged in the audit stream.

## What gets deleted

- Rows are deleted from the database.
- Associated files are deleted from object storage.
- Vector embeddings for deleted documents are removed from the knowledge store.
- Execution step-level detail is purged, but aggregate counts remain for analytics.

## Related

- [Environment reference](/self-hosted/configuration/environment-reference) — full list of Tale environment variables.
- [Governance](/platform/admin/governance) — per-org retention overrides and legal hold.
