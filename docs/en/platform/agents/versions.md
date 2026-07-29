---
title: Agent versions
description: The agent editor's History view — every save snapshotted, with a diff against the current version and one-click restore.
---

Every save of an agent creates a snapshot. The **History** button at the top right of the agent editor opens those snapshots in reverse chronological order; comparing shows what changed, and restoring replaces the current state with a past version. There is no manual-save versus auto-save distinction — every persisted change is a version.

The mechanic is small but load-bearing. Most teams adjust an agent's instructions weekly; without the history, the team would never trust the edits.

## Reviewing a change

Open the agent and click **History**. The list shows **Current version** at the top and every prior **Snapshot version** below, with the author and timestamp on each row. Pick a snapshot and **Compare changes** reviews the differences between it and the current version — the changed fields highlight — before you decide to restore.

## Restoring a version

From a snapshot, click **Restore this version**. The agent's current state is replaced with the snapshot — a toast confirms **Agent restored from history** — and the restore lands on the timeline as its own entry, so restores are additive, not destructive. Chats already running against the previous version continue on it until they end; the restored version applies from the next chat.

## What gets versioned

Versioning covers everything the agent itself carries: its display strings and description, its instructions, the tool and skill allowlists, the knowledge scope, its visibility, and its metadata. It does not reach the things an agent only points at. Replacing a document the agent retrieves from changes what it answers without bumping the agent's version, and so does replacing a skill bundle it binds — the binding names a slug, so the agent's own configuration is unchanged while its behaviour is not. To audit either, see [Audit logs](/platform/admin/governance/audit-logs).

## Where this fits

Versions are the agent's safety net for the same reason git is the codebase's: anything saved is recoverable. The companion page is [Audit logs](/platform/admin/governance/audit-logs) — it covers the org-wide who-did-what trail; History covers the per-agent what-was-it trail.
