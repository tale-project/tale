---
title: Retention configuration
description: Configure how long conversations, files, audit records, and executions are kept.
---

Tale has a single, central retention configuration that applies across every data domain — chat conversations, uploaded files, audit logs, workflow executions, and analytics records. The defaults are reasonable for most deployments; tune them when compliance, cost, or privacy rules require different settings.

Retention can be configured in two places:

- **Environment variables** — operator-set bounds. Per-org admins cannot relax these.
- **Governance UI** — per-organisation values within the operator's bounds.

## Environment variables

These apply to every organisation on the deployment. All values are in days unless noted otherwise. Pair `_MIN_DAYS` and `_MAX_DAYS` per category — operators can tighten the defaults but never relax them.

| Variable                                                   | Default min | Default max | Governs                                                                                                     |
| ---------------------------------------------------------- | ----------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `TALE_RETENTION_CONVERSATIONS_MIN_DAYS` / `_MAX_DAYS`      | `1`         | `3650`      | Chat conversations and their messages.                                                                      |
| `TALE_RETENTION_FILES_MIN_DAYS` / `_MAX_DAYS`              | `30`        | `3650`      | Uploaded files attached to chat or the knowledge base.                                                      |
| `TALE_RETENTION_AUDIT_MIN_DAYS` / `_MAX_DAYS`              | `365`       | `3650`      | Audit log entries. Min hard-coded at 365d (PCI/SOC2/ISO baseline) — operator can only RAISE.                |
| `TALE_RETENTION_EXECUTIONS_MIN_DAYS` / `_MAX_DAYS`         | `1`         | `365`       | Workflow execution detail.                                                                                  |
| `TALE_RETENTION_ANALYTICS_MIN_DAYS` / `_MAX_DAYS`          | `30`        | `3650`      | Per-request usage analytics rows.                                                                           |
| `TALE_RETENTION_LOGIN_ATTEMPTS_MIN_DAYS` / `_MAX_DAYS`     | `90`        | `365`       | Login failure forensic records. Min raised to 90d.                                                          |
| `TALE_RETENTION_CHAT_FILTER_EVENTS_MIN_DAYS` / `_MAX_DAYS` | `1`         | `365`       | Chat-filter (PII / banned-word / moderation) telemetry.                                                     |
| `TALE_RETENTION_USER_TEMP_MIN_HOURS` / `_MAX_HOURS`        | `1`         | `720`       | Ephemeral user-side temp files (hours).                                                                     |
| `TALE_RETENTION_AGENT_TEMP_MIN_HOURS` / `_MAX_HOURS`       | `1`         | `720`       | Ephemeral agent-side temp files (hours).                                                                    |
| `TALE_RETENTION_DISABLED`                                  | `false`     | —           | When `true`, the cleanup action no-ops with a warn-log. Operator kill-switch for migration windows / debug. |

Changes to env vars take effect on **next backend restart** (`docker compose restart tale-convex`) — Convex caches env at process start.

## Per-org policy

Within the operator's bounds, an org admin can configure each category independently in the Governance UI. The form pre-fetches the effective bounds via `getEffectiveRetentionBounds` and renders `<input min={N} max={M}>` plus inline helper text BEFORE the user types out-of-range values. Save attempts that violate a bound are rejected with `RETENTION_BELOW_FLOOR` or `RETENTION_EXCEEDS_CEILING` (each surfaces the exact bound + source).

## How deletion runs

The deletion job runs nightly at 04:00 UTC. The top-level dispatcher schedules a separate per-org cleanup with a deterministic 0–15 minute hash-based stagger so RAG and DB don't see a thundering-herd burst on every cron tick. A sibling cron at 01:00 UTC runs `effectReleasesOnly` so approved legal-hold releases past their 24h cooldown still take effect even when retention is paused via `TALE_RETENTION_DISABLED`.

For each org, every category runs in priority order:

1. Documents (RAG entries deleted via authenticated `ragFetch`)
2. User temp files
3. Agent temp files
4. Chat history (cascade-deletes message metadata, threadTodos, approvals, threadBranches, messageFeedback, chatFilterEvents, artifacts + revisions, agentWebhookUserThreads, sub-threads, agent-component messages, then the threadMetadata row itself)
5. Audit logs (writes a `auditLogCheckpoints` row capturing the chain head + count + max timestamp so the SHA-256 hash chain remains verifiable across the archive cut)
6. Workflow logs
7. Chat filter events
8. Usage ledger

Login attempts are email-scoped (not org-scoped) and run as a single global pass.

## Legal hold

When a `legalHolds` row exists for `(organizationId, targetType, targetId)` AND `releasedAt === undefined`, the cleanup runner refuses to physically delete the matching entity. The hold is sticky: `restoreChatThread` also refuses while a hold is active.

Target types: `thread`, `document`, `execution`, `userMembership`, `org`. A whole-org hold (`targetType: 'org'`) short-circuits the entire cleanup pass for that org.

Holds are placed via `placeLegalHold` (admin only). Release is a TWO-STEP maker-checker flow: any admin files via `requestLegalHoldRelease`, and a DIFFERENT admin approves via `approveLegalHoldRelease`. Approval imposes a 24h cooldown (configurable via `TALE_LEGAL_HOLD_RELEASE_COOLDOWN_HOURS`) plus a 5-minute minimum delay between request and approval to defeat chained-call attacks. `rejectLegalHoldRelease` is the rejection path. Self-approval is refused unless the operator opts in by setting `TALE_LEGAL_HOLD_SINGLE_ADMIN_OK=true` (single-admin deployments) — the audit log records `legal_hold_release_approved_self` so the bypass is loud. Released holds are RETAINED in the table for the audit trail — never physically deleted.

Org-scoped holds (`targetType: 'org'`, the "halt all retention" hold) require dual-control by default; placement is refused unless `TALE_LEGAL_HOLD_SINGLE_ADMIN_OK=true` is set.

Closing a `legalMatter` via `closeLegalMatter` automatically files a pending release request for every linked active hold (matched by `matterRef`). Approval still requires a second admin per linked hold — matter close does NOT auto-release.

The cleanup runner pre-fetches every active hold ONCE per run, so in-flight runs see a consistent snapshot. Holds placed mid-run protect the _next_ run; the brief window is acceptable per ISO 27050 since cleanup is daily.

## GDPR Art 17 erasure

For verified subject erasure requests, an admin can call `requestErasure(organizationId, userId, reason)` to immediately cascade-delete every thread the named user owns in that org. This BYPASSES the retention grace window and the cooldown-on-shortening (so erasure happens "without undue delay" per Art 17). Refused if any matching legal hold is active; the response lists held items for the admin's reference.

Audit subtype `gdpr_erasure_executed` (`category: 'admin'`) records actor, reason, threads erased, and any blocked-by-hold list.

## What gets deleted

- Rows are deleted from the database.
- Associated files are deleted from object storage.
- Vector embeddings for deleted documents are removed from the knowledge store.
- For chat-history retention, every descendant row (messages, metadata, todos, feedback, artifacts, etc.) is cascade-deleted via the shared `cascadeDeleteThreadChildren` helper so user-delete and retention-delete never drift on which tables get cleaned up.
- Audit log retention writes an `auditLogCheckpoints` row at every batch boundary so the SHA-256 hash chain stays verifiable.

## Related

- [Environment reference](/self-hosted/configuration/environment-reference) — full list of Tale environment variables.
- [Governance](/platform/admin/governance) — per-org retention settings and legal hold management.
