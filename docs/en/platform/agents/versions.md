---
title: Agent versions
description: The agent's History tab — every change snapshotted, with comparison and restore for any past version.
---

Every save of an agent creates a snapshot. The **History** tab on the agent surfaces the snapshots in reverse chronological order; comparing two snapshots shows the diff of what changed, and restoring a past snapshot replaces the current state with that version. There is no manual save versus auto-save distinction — every persisted change is a version.

The mechanic is small but load-bearing. Most teams adjust an agent's instructions weekly; without the history, the team would never trust the edits.

## A worked diff

Open the agent and switch to **History**. The list shows **Current version** at the top and every prior **Snapshot version** below, with the author and timestamp on each row. Click two rows and **Compare changes** opens a side-by-side diff; the changed fields highlight. Close the diff to return to the list.

## Restoring a version

Open any past snapshot and click **Restore this version**. The agent's current state is overwritten with the snapshot, and the act of restoring itself creates a new snapshot on the timeline — restores are not destructive, just additive. Chats already running against the previous current version continue to run on it until they end; the restored version applies to new chats from that point on.

## What gets versioned

Versioning covers instructions, model picks, knowledge bindings, tool toggles, conversation starters, and metadata. It does not cover the underlying knowledge sources themselves — replacing a document the agent is bound to changes what the agent retrieves without bumping the agent's version. To audit a knowledge change, see [Audit logs](/platform/admin/governance/audit-logs).

## Where this fits

Versions is the agent's safety net for the same reason git is the codebase's: anything saved is recoverable. The companion page is [Audit logs](/platform/admin/governance/audit-logs) — it covers the org-wide who-did-what trail; versions cover the per-agent what-was-it trail.
