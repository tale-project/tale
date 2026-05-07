---
title: Retention configuration
description: Configure how long conversations, files, audit records, and executions are kept.
---

Tale has a single, central retention configuration that applies across every data domain — chat conversations, uploaded files, audit logs, workflow executions, and analytics records. The defaults are reasonable for most deployments; tune them when compliance, cost, or privacy rules require different settings.

Retention bounds resolve in three layers:

- **Per-org JSON file** — operator-controlled baseline at `$TALE_CONFIG_DIR/retention/{orgSlug}.json`. JSON file is the source of truth. Auto-seeded by the convex container on first boot per `TALE_VERSION`.
- **Environment variables** — operator-set tightening overlay applied on top of the file values. Can only tighten min/max (raise floor, lower ceiling); cannot relax beyond the file values.
- **Governance UI** — per-organisation values within the operator's effective bounds.

## File-based per-org defaults

Per-org files live under `$TALE_CONFIG_DIR/retention/`:

- `default.json` — the bootstrap org's retention bounds + initial values. The default org's slug is hardcoded to `default`, so this fits the `{orgSlug}.json` rule with no special-case naming.
- `{orgSlug}.json` (optional) — per-org overrides for additional orgs. When an org has no file of its own, the resolver falls back to `default.json`.

Each file declares any subset of the 16 retention categories plus an optional **root-level** `_metadata` block. A category present in the file MUST contain `min` / `max` / `default`; per-category `_metadata` is optional.

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

Where:

- `min` / `max` — operator-defined outer bounds. Org admins cannot pick values outside this range.
- `default` — starting per-org retention value, used until an org admin changes it in the Governance UI.
- `_metadata` (root, optional) — env-binding declaration. Two fields, both optional:
  - `envPrefix` — common prefix for every env name. Plain string concatenation: `${envPrefix}${suffix}` → full env name. The trailing separator (e.g. `_`) is part of `envPrefix` itself, fully visible. Omit `envPrefix` and the keys of `envNames` are the full env names.
  - `envNames` — direct 1:1 map from env-name suffix → JSON object path. Each entry says "this env variable controls this field." Paths must match `${category}.${min|max|default}` for a known retention category. Operator reads the file and sees at a glance which env affects which field — no derivation, no rule to mentally apply.
  - `envPrefix` and `envNames` are ONLY allowed at the root `_metadata`. Placing them inside a per-category `_metadata` is rejected at schema-validation time.
- `_metadata` (per-category, optional) — display overrides for the Governance UI editor:
  - `label`, `help`, `order`, `hidden`. All optional.

Categories absent from an org's file fall back to that org's `default.json`. If both are absent (e.g., the operator deleted `default.json`), retention reads return `RETENTION_CONFIG_MISSING` — restart the container with `FORCE_SEED=true` (or bump `TALE_VERSION`) to re-seed `default.json` from the bundled `examples/retention/default.json`.

`unit` (`days` vs `hours`) is NOT configurable per category — it's tied to runtime cleanup math and lives in platform code only.

After editing a file, the next editor reload picks up the new values automatically — no Convex restart required (file IO happens on every action call).

**Type constraint on env binding.** Env vars are flat strings. The resolver auto-coerces per the field's runtime type: `number` → `parseInt` / `parseFloat`; `string` → used verbatim; `boolean` → `"true"` / `"false"` (case-insensitive); `date` → ISO 8601; `array<scalar>` → split on `,` and each element coerced. Complex objects / nested records / discriminated unions **cannot** carry env binding — putting structured data in a single env string is ambiguous and lossy. For retention specifically, all bindable fields are integers, so this is theoretical here; it matters when the same `_metadata.envPrefix` pattern is reused for future config areas.

### Display overrides

A category-level `_metadata` block carries optional display-only fields that shadow the platform i18n strings:

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

When `hidden: true`, the category disappears from the editor (cleanup behavior is unchanged — bounds still apply). Env binding lives at the root `_metadata`, never per-category — see above.

### Environment admin page

The Governance sidebar's **Environment** entry shows a read-only snapshot of every retention env var the resolver currently considers — name, current value, binding source (`metadata` when declared in `_metadata.envNames`, `none` when no entry maps to that field), and whether it's actively tightening. Useful for "is my override actually wired?" diagnostics.

## Environment variables (tightening overlay)

These apply to every organisation on the deployment, on top of the per-org file values. They can only TIGHTEN bounds — raise a floor or lower a ceiling — never relax beyond what the file declares.

The platform's `docker-entrypoint.sh` syncs every env var on the platform container to Convex by default (matching `bun run dev` behavior). A small `ENV_SYNC_DENYLIST` array near the top of the entrypoint is the only platform-side maintenance burden — it's currently empty and only grows when a specific var is shown to actively conflict with Convex. Operators don't need to negotiate platform-side allowlist updates to add custom env vars.

The effective bounds an org admin sees are merged from the file values and the env overrides:

- Effective min = `max(file_min, env _MIN)` — env raises the floor only.
- Effective max = `min(file_max, env _MAX)` — env lowers the ceiling only.

Setting an env var to `0` is rejected with an error (it would collapse the valid range). Empty or unset env vars fall back to the file value.

Env values that try to widen a bound are silently clamped to the file value — no error, no warning.

The columns below show the **shipped** floor / ceiling / initial values from the bundled `examples/retention/default.json`. Operators can change these by editing `$TALE_CONFIG_DIR/retention/default.json`; env overrides apply on top.

Env names below are the ones declared in the root `_metadata.envNames` map of the shipped `examples/retention/default.json`. The shipped `envPrefix` is `"TALE_RETENTION_"` (with trailing underscore). Full env names are formed by plain string concatenation: `envPrefix + suffix` (e.g. `"TALE_RETENTION_" + "AUDIT_MIN"` → `TALE_RETENTION_AUDIT_MIN`). To rename a binding, rebind a field to a different env, or add a new binding, edit `_metadata.envNames` directly — no code change required.

| Variable                                     | Floor   | Ceiling | Initial | Governs                                                                                                     |
| -------------------------------------------- | ------- | ------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `TALE_RETENTION_CONVERSATIONS_MIN` / `_MAX`  | `1`     | `3650`  | `90`    | Chat conversations and their messages.                                                                      |
| `TALE_RETENTION_FILES_MIN` / `_MAX`          | `30`    | `3650`  | `365`   | Uploaded files attached to chat or the knowledge base.                                                      |
| `TALE_RETENTION_AUDIT_MIN` / `_MAX`          | `365`   | `3650`  | `730`   | Audit log entries. Floor hard-coded at 365d (PCI/SOC2/ISO baseline) — operator can only RAISE.              |
| `TALE_RETENTION_EXECUTIONS_MIN` / `_MAX`     | `1`     | `365`   | `30`    | Workflow execution detail.                                                                                  |
| `TALE_RETENTION_ANALYTICS_MIN` / `_MAX`      | `30`    | `3650`  | `365`   | Per-request usage analytics rows.                                                                           |
| `TALE_RETENTION_CHAT_FILTER_MIN` / `_MAX`    | `1`     | `365`   | `90`    | Chat-filter (PII / banned-word / moderation) telemetry.                                                     |
| `TALE_RETENTION_PROMPTS_MIN` / `_MAX`        | `30`    | `3650`  | `730`   | Saved prompt templates (org-scope only).                                                                    |
| `TALE_RETENTION_FEEDBACK_MIN` / `_MAX`       | `30`    | `3650`  | `365`   | Per-message thumbs / comments. May contain quoted user content.                                             |
| `TALE_RETENTION_MEMORY_AUDIT_MIN` / `_MAX`   | `30`    | `3650`  | `365`   | Personalization memory change-log.                                                                          |
| `TALE_RETENTION_CUSTOMERS_MIN` / `_MAX`      | `30`    | `3650`  | `730`   | CRM customer records (name, email, address, locale, metadata).                                              |
| `TALE_RETENTION_VENDORS_MIN` / `_MAX`        | `30`    | `3650`  | `730`   | Vendor records (name, email, phone, address, free-text notes).                                              |
| `TALE_RETENTION_INBOX_MIN` / `_MAX`          | `30`    | `3650`  | `730`   | External customer-channel inbox (`externalConversations`).                                                  |
| `TALE_RETENTION_MSG_META_MIN` / `_MAX`       | `30`    | `3650`  | `365`   | Per-message reasoning, prompt context window, tool I/O. High-PII derived data.                              |
| `TALE_RETENTION_USER_TEMP_MIN` / `_MAX`      | `1`     | `720`   | `24`    | Ephemeral user-side temp files (hours).                                                                     |
| `TALE_RETENTION_AGENT_TEMP_MIN` / `_MAX`     | `1`     | `720`   | `24`    | Ephemeral agent-side temp files (hours).                                                                    |
| `TALE_RETENTION_LOGIN_ATTEMPTS_MIN` / `_MAX` | `90`    | `365`   | `90`    | Login attempt records.                                                                                      |
| `TALE_RETENTION_DISABLED`                    | `false` | —       | —       | When `true`, the cleanup action no-ops with a warn-log. Operator kill-switch for migration windows / debug. |

Changes to env vars take effect on **next backend restart** (`docker compose restart tale-convex`) — Convex caches env at process start.

## Per-org policy

Within the operator's effective bounds, an org admin can configure each category independently in the Governance UI. The form fetches the effective bounds via the V8 action `getRetentionBoundsAction` (which reads the per-org file with `default.json` fallback and applies env tightening) and renders `<input min={N} max={M}>` plus inline helper text BEFORE the user types out-of-range values. Save attempts that violate a bound are rejected with `RETENTION_BELOW_FLOOR` or `RETENTION_EXCEEDS_CEILING` (each surfaces the exact bound + source).

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

Login attempts are email-scoped (not org-scoped) and run as a single global pass with a fixed 30-day TTL. Per-org `loginAttemptRetentionDays` config does not govern this sweep, and the TTL is intentionally not env-tunable to keep brute-force forensic floor uniform across deployments.

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
