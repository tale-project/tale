---
title: Retention configuration
description: Configure how long conversations, files, audit records, and executions are kept.
---

Retention controls how long every category of data Tale stores stays alive — chat conversations, uploaded files, audit log entries, workflow execution detail, analytics rows, customer records, and a dozen more. This page is for operators who need to tune those bounds for compliance, cost, or privacy reasons; the in-app per-organisation knob that runs within the operator's bounds lives under [Governance](/platform/admin/governance). The shipped defaults are conservative enough for most installs, so most operators leave the file and env layers alone and only ever touch the per-org slider in the UI.

The model is three layers deep. The **per-org JSON file** sets the outer bounds. **Environment variables** tighten those bounds (raise the floor, lower the ceiling) on top. The **Governance UI** picks a value within whatever the operator has left available. Each layer can only ever tighten the next — operators can never widen what the file declares.

## File-based per-org defaults

The per-org files live under `$TALE_CONFIG_DIR/retention/`. The convex container auto-seeds them on first boot per `TALE_VERSION`; subsequent edits take effect on the next read because the file is consulted on every retention action.

- `default.json` — the bootstrap org's retention bounds and initial values. Every org without its own file falls back to this one.
- `{orgSlug}.json` (optional) — per-org overrides for additional orgs.

Each file declares any subset of the sixteen retention categories, plus an optional root-level `_metadata` block. A category present in the file must include `min`, `max`, and `default`; per-category `_metadata` for display overrides is optional.

```json
{
  "_metadata": {
    "envPrefix": "TALE_RETENTION_",
    "envNames": {
      "AUDIT_MIN": "auditLog.min",
      "AUDIT_MAX": "auditLog.max",
      "AUDIT_DEFAULT": "auditLog.default",
      "FILES_MIN": "documents.min",
      "FILES_MAX": "documents.max",
      "FILES_DEFAULT": "documents.default",
      "INBOX_MIN": "externalConversations.min",
      "INBOX_MAX": "externalConversations.max",
      "INBOX_DEFAULT": "externalConversations.default"
    }
  },
  "auditLog": { "min": 365, "max": 3650, "default": 730 },
  "documents": { "min": 30, "max": 3650, "default": 365 },
  "externalConversations": { "min": 30, "max": 3650, "default": 730 }
}
```

`min` and `max` are the operator-defined outer bounds — org admins cannot pick values outside this range. `default` is the starting per-org retention value, used until an org admin changes it in **Governance**. The root `_metadata.envPrefix` and `_metadata.envNames` map declare the binding from env variable to JSON field; each entry says "this env variable controls this field." Paths must match `${category}.${min|max|default}` for a known retention category. `envPrefix` and `envNames` are only allowed at the root `_metadata` — placing either inside a per-category `_metadata` is rejected at schema validation.

Categories absent from an org's file fall back to that org's `default.json`. If both are absent — for example, the operator deleted `default.json` — retention reads return `RETENTION_CONFIG_MISSING`. Restart the convex container with `FORCE_SEED=true` (or bump `TALE_VERSION`) to re-seed `default.json` from the bundled `examples/retention/default.json`.

The category unit (days versus hours) is not configurable per category — it's tied to the runtime cleanup math and lives in platform code. After editing a file, the next retention action picks up the new values automatically because file I/O happens on every read; no convex restart is required.

### Type coercion on env binding

Env vars are flat strings. The resolver coerces each one per the field's runtime type: `number` via `parseInt` or `parseFloat`; `string` verbatim; `boolean` from `"true"` or `"false"` (case-insensitive); `date` as ISO 8601; `array<scalar>` split on `,` with each element coerced. Complex objects, nested records, and discriminated unions cannot carry env binding — putting structured data in a single env string is ambiguous and lossy. For retention specifically, every bindable field is an integer, so the rule is theoretical here; it matters when the same `_metadata.envPrefix` pattern is reused for future config areas.

### Display overrides

A category-level `_metadata` block carries optional display-only fields for the Governance editor. `label` and `help` shadow the platform i18n strings; `order` and `hidden` change the visual layout.

```json
{
  "auditLog": {
    "min": 365,
    "max": 3650,
    "default": 730,
    "_metadata": {
      "label": "Audit log retention (PCI scope)",
      "help": "Operator-pinned for our compliance program.",
      "order": 1,
      "hidden": false
    }
  }
}
```

When `hidden: true`, the category disappears from the editor; cleanup behaviour is unchanged because the bounds still apply. Env binding lives at the root `_metadata`, never per category.

### The Environment admin page

The Governance sidebar's **Environment** entry is a read-only snapshot of every retention env var the resolver currently considers — name, current value, binding source (`metadata` when declared in `_metadata.envNames`, `none` when no entry maps to that field), and whether it's actively tightening. It's the answer to "is my override actually wired?" — useful when an env value seems to have no effect.

## Environment variables (tightening overlay)

The environment overrides apply across every organisation on the deployment, on top of the per-org file values. They can only tighten — raise a floor or lower a ceiling — never relax beyond what the file declares.

The effective bounds an org admin sees come from `max(file_min, env_MIN)` for the floor and `min(file_max, env_MAX)` for the ceiling. Setting an env var to `0` is rejected as an error because it would collapse the valid range; empty or unset env vars fall back to the file value. Env values that try to widen a bound are silently clamped to the file value — no error, no warning.

The platform's entrypoint syncs every env var on the platform container to convex by default (matching the local `bun run dev` behaviour). A small `ENV_SYNC_DENYLIST` array near the top of the entrypoint is the only platform-side maintenance burden; it's currently empty and only grows when a specific variable is shown to actively conflict with Convex. Operators don't need to negotiate platform-side allowlist updates to add custom env vars.

The columns below show the **shipped** floor, ceiling, and initial values from the bundled `examples/retention/default.json`. Operators can change these by editing `$TALE_CONFIG_DIR/retention/default.json`; env overrides apply on top. To rename a binding, rebind a field, or add a new binding, edit `_metadata.envNames` directly — no code change required.

| Variable                                     | Floor   | Ceiling | Initial | Governs                                                                                                     |
| -------------------------------------------- | ------- | ------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `TALE_RETENTION_CONVERSATIONS_MIN` / `_MAX`  | `1`     | `3650`  | `90`    | Chat conversations and their messages.                                                                      |
| `TALE_RETENTION_FILES_MIN` / `_MAX`          | `30`    | `3650`  | `365`   | Uploaded files attached to chat or the knowledge base.                                                      |
| `TALE_RETENTION_AUDIT_MIN` / `_MAX`          | `365`   | `3650`  | `730`   | Audit log entries. Floor hard-coded at 365 days (PCI/SOC2/ISO baseline) — operator can only raise.          |
| `TALE_RETENTION_EXECUTIONS_MIN` / `_MAX`     | `1`     | `365`   | `30`    | Workflow execution detail.                                                                                  |
| `TALE_RETENTION_ANALYTICS_MIN` / `_MAX`      | `30`    | `3650`  | `365`   | Per-request usage analytics rows.                                                                           |
| `TALE_RETENTION_CHAT_FILTER_MIN` / `_MAX`    | `1`     | `365`   | `90`    | Chat-filter (PII, banned-word, moderation) telemetry.                                                       |
| `TALE_RETENTION_PROMPTS_MIN` / `_MAX`        | `30`    | `3650`  | `730`   | Saved prompt templates (org-scope only).                                                                    |
| `TALE_RETENTION_FEEDBACK_MIN` / `_MAX`       | `30`    | `3650`  | `365`   | Per-message thumbs and comments. May contain quoted user content.                                           |
| `TALE_RETENTION_MEMORY_AUDIT_MIN` / `_MAX`   | `30`    | `3650`  | `365`   | Personalisation memory change-log.                                                                          |
| `TALE_RETENTION_CUSTOMERS_MIN` / `_MAX`      | `30`    | `3650`  | `730`   | CRM customer records (name, email, address, locale, metadata).                                              |
| `TALE_RETENTION_VENDORS_MIN` / `_MAX`        | `30`    | `3650`  | `730`   | Vendor records (name, email, phone, address, free-text notes).                                              |
| `TALE_RETENTION_INBOX_MIN` / `_MAX`          | `30`    | `3650`  | `730`   | External customer-channel inbox.                                                                            |
| `TALE_RETENTION_MSG_META_MIN` / `_MAX`       | `30`    | `3650`  | `365`   | Per-message reasoning, prompt context window, tool I/O. High-PII derived data.                              |
| `TALE_RETENTION_USER_TEMP_MIN` / `_MAX`      | `1`     | `720`   | `24`    | Ephemeral user-side temp files (hours).                                                                     |
| `TALE_RETENTION_AGENT_TEMP_MIN` / `_MAX`     | `1`     | `720`   | `24`    | Ephemeral agent-side temp files (hours).                                                                    |
| `TALE_RETENTION_LOGIN_ATTEMPTS_MIN` / `_MAX` | `90`    | `365`   | `90`    | Login attempt records.                                                                                      |
| `TALE_RETENTION_DISABLED`                    | `false` | —       | —       | When `true`, the cleanup action no-ops with a warn-log. Operator kill-switch for migration windows / debug. |

Changes to env vars take effect on the next backend restart (`docker compose restart tale-convex`) — Convex caches env at process start.

## Per-org policy

Within the operator's effective bounds, an org admin configures each category independently in the Governance UI. The form fetches the bounds, renders an input pre-clamped to `min` and `max`, and rejects out-of-range values at save time with `RETENTION_BELOW_FLOOR` or `RETENTION_EXCEEDS_CEILING`. Either error names the exact bound and the source (`file` or `env`), so the org admin knows which layer to argue with.

## How deletion runs

The deletion job runs nightly at 04:00 UTC. The top-level dispatcher schedules a separate per-org cleanup with a deterministic 0–15 minute hash-based stagger so RAG and the database don't see a thundering-herd burst on every cron tick. A sibling cron at 01:00 UTC runs `effectReleasesOnly` so approved legal-hold releases past their 24-hour cooldown still take effect even when retention is paused via `TALE_RETENTION_DISABLED`.

For each org, every category runs in priority order:

1. Documents (RAG entries deleted via authenticated `ragFetch`).
2. User temp files.
3. Agent temp files.
4. Chat history (cascade-deletes message metadata, thread todos, approvals, branches, feedback, chat filter events, artifacts and their revisions, sub-threads, agent-component messages, then the `threadMetadata` row itself).
5. Audit logs (writes a checkpoint row capturing the chain head, count, and max timestamp so the SHA-256 hash chain stays verifiable across the cut).
6. Workflow logs.
7. Chat filter events.
8. Usage ledger.

Login attempts are email-scoped (not org-scoped) and run as a single global pass with a fixed 30-day TTL. Per-org `loginAttemptRetentionDays` config does not govern this sweep, and the TTL is intentionally not env-tunable to keep the brute-force forensic floor uniform across deployments.

## Legal hold

When a `legalHolds` row exists for `(organizationId, targetType, targetId)` and `releasedAt` is undefined, the cleanup runner refuses to physically delete the matching entity. The hold is sticky: `restoreChatThread` also refuses while a hold is active.

Target types: `thread`, `document`, `execution`, `userMembership`, `org`. A whole-org hold (`targetType: 'org'`) short-circuits the entire cleanup pass for that org.

Holds are placed via `placeLegalHold` (admin only). Release is a two-step maker-checker flow: any admin files via `requestLegalHoldRelease`, and a different admin approves via `approveLegalHoldRelease`. Approval imposes a 24-hour cooldown (configurable via `TALE_LEGAL_HOLD_RELEASE_COOLDOWN_HOURS`) plus a 5-minute minimum delay between request and approval to defeat chained-call attacks. `rejectLegalHoldRelease` is the rejection path. Self-approval is refused unless the operator opts in by setting `TALE_LEGAL_HOLD_SINGLE_ADMIN_OK=true` (single-admin deployments); the audit log records `legal_hold_release_approved_self` so the bypass is loud.

Org-scoped holds (the "halt all retention" hold) require dual control by default; placement is refused unless `TALE_LEGAL_HOLD_SINGLE_ADMIN_OK=true` is set. Closing a `legalMatter` via `closeLegalMatter` automatically files a pending release request for every linked active hold; approval still requires a second admin per linked hold — matter close does not auto-release. Released holds are retained in the table for the audit trail and never physically deleted.

The cleanup runner pre-fetches every active hold once per run, so in-flight runs see a consistent snapshot. Holds placed mid-run protect the next run; the brief window is acceptable per ISO 27050 because cleanup is daily.

## Audit-chain PII protection

The audit log is retained for years (default 730 days, floor 365). To keep that chain from carrying long-lived plaintext email addresses and IPs from unauthenticated user input (failed login attempts in particular), set `TALE_AUDIT_PEPPER` to a unique secret of at least 16 characters. New audit rows then store an HMAC-SHA256 hash of the email and a coarse network prefix of the IP (`/24` for v4, `/64` for v6) in dedicated `actorEmailHash` and `actorIpHash` columns; the plaintext columns stay empty. Existing rows are not rewritten — rotation invalidates correlation across the boundary, which is the operator's intent.

When `TALE_AUDIT_PEPPER` is unset or shorter than 16 chars, audit writers fall back to plaintext and log a one-shot `[SECURITY]` warning to stderr at first call. Set the variable in production before exposing the deployment to real users.

`TALE_AUDIT_SIGNING_KEY` (separate from the pepper) signs the audit-log checkpoint rows so the integrity verifier can distinguish a deliberate retention/PII-scrub boundary from tampering. Without a signing key, the chain is still tamper-evident through the SHA-256 chain itself; the signature is defense-in-depth against an attacker who can both delete rows and forge a fresh checkpoint.

## GDPR Art 17 erasure

For verified subject erasure requests, an admin calls `requestErasure(organizationId, userId, reason)` to immediately cascade-delete every thread the named user owns in that org. This bypasses the retention grace window and the cooldown-on-shortening so erasure happens "without undue delay" per Art 17. Refused if any matching legal hold is active; the response lists held items for the admin's reference.

The audit subtype `gdpr_erasure_executed` (category `admin`) records the actor, the reason, the threads erased, and any blocked-by-hold list.

## What gets deleted

Rows are deleted from the database. Associated files are deleted from object storage. Vector embeddings for deleted documents are removed from the knowledge store. For chat-history retention, every descendant row — messages, metadata, todos, feedback, artifacts, and the rest — is cascade-deleted via the shared helper so user-delete and retention-delete never drift on which tables get cleaned up. Audit-log retention writes a checkpoint row at every batch boundary so the SHA-256 hash chain stays verifiable.

## Where this fits

Retention is the per-table lifespan policy for everything Tale stores. The defaults are conservative; the per-org overrides come from [Governance](/platform/admin/governance); and every environment variable that gates retention behaviour is catalogued in [Environment reference](/self-hosted/configuration/environment-reference). Reach for this page when a compliance officer asks how long a particular table lives; reach for Governance when the answer needs to change for one specific tenant.
