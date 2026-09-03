---
title: Retention
description: How org-wide retention is configured — operator bounds in env vars and UI controls under Governance for chats, documents, audit logs, and ledger rows.
---

Retention in Tale is the policy that deletes old data on a schedule — chats, documents, audit logs, workflow executions, token-usage ledger rows. The operator sets bounds (minimums and maximums) per category; each org's admin picks the actual retention window inside those bounds via **Settings > Governance > Retention policy**. The split exists so a hosting team can enforce compliance floors without micromanaging every tenant.

This page covers the operator surface. The admin-facing controls and the per-category descriptions live in [Governance > Retention policy](/platform/admin/governance/policies-and-limits).

## How the bounds work

Each retention category — chat threads, documents, contacts, vendors, prompt templates, ledger rows, audit logs, workflow executions, workflow trigger logs, login attempts — has a `min` and a `max`. An org admin sets a value inside that window. Tightening the floor across an existing instance is a multi-step flow: operator proposes the new bound, every affected admin sees a banner, the change applies once accepted.

| Category                | Typical floor | Why                                            |
| ----------------------- | ------------- | ---------------------------------------------- |
| Chat history            | 30 d          | Most users want recent context, not forever    |
| Documents               | 1 y           | Knowledge tends to age out slowly              |
| Audit logs              | 1 y minimum   | Compliance frameworks expect a year            |
| Token-usage ledger      | 90 d          | Analytics and budget reports rely on rows      |
| Workflow execution logs | 30 d          | Debugging rarely reaches further back          |
| Login attempts          | 30 d          | Brute-force investigation needs the audit tail |

The shipped defaults are loose; tighten per your compliance posture.

## Where you set bounds

Under the org-first layout, retention bounds are **per-org**: edit `retention.json` directly inside an org's subtree under `TALE_CONFIG_DIR` (defaults to `/app/data/` inside the platform container, so the file lives at `/app/data/<org>/retention.json`, e.g. `/app/data/default/retention.json`). Each org has its own file; the `default` org's file is the template a fresh deployment picks up on first boot.

```json
{
  "chatHistory": { "min": 30, "max": 730, "unit": "days" },
  "documents": { "min": 1, "max": 3650, "unit": "days" },
  "auditLog": { "min": 365, "max": 3650, "unit": "days" },
  "tokenLedger": { "min": 90, "max": 1095, "unit": "days" }
}
```

The platform container watches the file; changes propose a bounds update for every existing org. Admins see the proposal in their **Retention policy** screen and apply it themselves. The propose-then-apply step is deliberate: tightening a floor shortens history, which is a destructive action no operator should land silently on every tenant.

The admin-chosen retention windows live in a separate file, `retention-policy.json`, alongside the bounds in the same `governance/` folder. It holds flat `<category>Enabled` / `<category>RetentionDays` fields (e.g. `"auditLogEnabled": true, "auditLogRetentionDays": 730`), not the `min`/`max` bounds. That file is written by **Settings > Governance > Retention policy** in the app, so admins normally never edit it by hand — keep it distinct from the operator-owned bounds file.

## The retention sweep

A scheduled job inside `tale-backend-worker` runs the actual deletion. Each category is swept independently — a slow run on one does not block the others. Deletions are audited (every category has its own `*.retention_deleted` event), and restoring an entity inside its grace window is possible from **Trash** before the final sweep.

Audit log entries are themselves subject to retention, but their floor is enforced per-deployment, not per-org: the strictest (shortest) audit-log retention across all orgs is what actually runs. A stricter tenant pulls everyone tighter — keep this in mind on multi-tenant instances.

## Legal hold

A legal hold freezes retention for a specific scope: a single thread, a contact record, or an entire organization. Held entities skip the sweep until the hold is released. The hold itself is audited; org-wide holds are loud enough that the UI surfaces a confirmation before they apply.

## Where this fits

The bounds file is the operator's lever; the per-category windows the admin sees are documented in [Retention policy](/platform/admin/governance/policies-and-limits). If you are setting bounds against a compliance framework (GDPR, HIPAA, SOC 2), the audit-log floor is usually what auditors check first.
