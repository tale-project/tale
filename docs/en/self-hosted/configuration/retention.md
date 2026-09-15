---
title: Configure retention bounds
description: Set organization retention bounds, apply policy changes deliberately and understand which data the cleanup job removes.
---
Retention controls how long Tale keeps each category of data. Operators set the allowed bounds; organization admins enable categories and choose a duration within those bounds. A shorter duration can delete existing history, so review its effect before applying it.

## Understand bounds and policy

Two files under `TALE_CONFIG_DIR/<orgSlug>/governance/` have different jobs:

| File | Purpose |
| --- | --- |
| `retention.yml` | Operator bounds and defaults for every category. JSON is also accepted. |
| `retention-policy.yml` | The organization’s chosen enabled states and durations. Managed by the governance settings. |

The organization gets its own files when it is created. A change to one organization’s file does not change another organization’s policy. There is no fallback to a `default` organization when an organization’s bounds file is missing.

Each category has `min`, `max`, `default` and `unit`. Raising `min` requires data to be kept longer; lowering `max` limits how long it may be kept. Neither value enables cleanup by itself. The applied policy determines whether the category is enabled.

## Edit the organization’s bounds

Start from the organization’s existing complete file. Preserve categories you are not changing. This fragment shows the shape of one category, rather than a replacement for the whole file:

```yaml
chatHistory:
  min: 30
  max: 730
  default: 90
  unit: days
```

Most categories use days; `userTempHours` and `agentTempHours` use hours. The token-usage category is named `usageLedger`. Use the category identifiers already present in the file so validation can catch mistakes.

Environment overrides are declared explicitly by the file’s root `_metadata.envNames`, with an optional `_metadata.envPrefix`. The bundled file maps `TALE_RETENTION_AUDIT_MIN` to `auditLog.min`, for example. A minimum override can only raise the floor; a maximum override can only lower the ceiling. Restart the backend processes after changing their environment.

## Review and apply a change

After editing bounds, ask the organization admin to review the proposed change in [Policies and limits](/platform/admin/governance/policies-and-limits). Cleanup uses the applied bounds snapshot; an operator’s file edit alone does not silently apply new bounds.

Review enabled categories, the old and new durations, and any grace period before applying. A value such as `auditLogRetentionDays: 730` is a chosen duration, while `auditLog.min: 365` is a lower bound. Keep those meanings separate when reviewing a diff.

<Tip>

Test a shorter policy on synthetic data first. Confirm that a record inside the window remains, an expired record follows its category’s deletion behavior, and a held record remains protected.

</Tip>

## Understand the cleanup result

The backend worker runs scheduled cleanup per organization. Threads, documents, contacts and external conversations have lifecycle handling; row-level categories can be deleted directly after their applicable retention and grace period. Do not assume that every deleted record appears in Trash.

Audit retention is also organization-scoped. It removes the oldest eligible prefix of that organization’s audit chain, stopping when a held row must remain. One tenant’s shorter window does not shorten another tenant’s history.

`TALE_RETENTION_DISABLED=true` pauses scheduled retention cleanup for an operator-controlled maintenance window. It does not restore deleted data or disable other deletion paths. Record when you enable it and remove it when the maintenance is complete.

## Preserve held data

Legal holds override retention for their supported scope. An organization-wide hold protects the organization; narrower holds protect the matching entities or custodians. Review the [legal hold workflow](/platform/admin/governance/legal-hold) before changing a policy that affects held data.

A hold is not a backup. Once deletion has completed outside a hold, increasing the retention duration cannot recover the data; recovery depends on a retained backup and its matching deployment state.
