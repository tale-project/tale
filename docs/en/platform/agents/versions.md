---
title: Agent versions
description: The agent editor's History view is not part of this version — persona files keep a history behind the API, and the versioning you see in the product belongs to automations.
---

This page used to describe the **History** button of the agent editor — every save a snapshot, a diff against the current version, one-click restore. The editor and its History view are not part of this version of Tale. Versioning did not disappear with it: automations are versioned in the product, and agent personas keep a file history that the platform's API exposes.

<Note>

The agent History view is not available in this version. There is no agent editor to open it from.

</Note>

## What is versioned today

**Automations** carry the versioning you can see. Every save on the canvas and every uploaded pack becomes a new immutable version; you promote one to be live on the automation's page, and the **Automations** list shows each automation's version count next to the version that is live — or **Not deployed**. [The workflow editor](/platform/automations/editor) covers versions, test runs, and deploying; [Add automations](/platform/automations/catalog) covers what an upload appends.

**Agent personas** keep a history behind the API. Every save leaves the superseded file in the persona's history trail, and restoring an entry snapshots the current file first, so a restore is additive and never destroys the state it replaced; a history entry that would no longer parse is refused with the reason rather than written. No screen shows this trail in this version — it is reachable through the platform's own API and, for self-hosted operators, on disk next to the persona files. [Agents (admin view)](/platform/admin/agents) explains who may restore what.

**Skills** keep the superseded `SKILL.md` when an uploaded package replaces a bundle, as [Add automations](/platform/automations/catalog) describes. For who did what across the organization, the [audit logs](/platform/admin/governance/audit-logs) are the trail.

## Where this fits

Versions in this version live where the editing happens: on the automation's page for automations, in the history trail for personas, in each skill's history for bundles. The companion read is [Audit logs](/platform/admin/governance/audit-logs) for the who-did-what across all of them.
