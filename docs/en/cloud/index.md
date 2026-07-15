---
title: Cloud
description: Tale Cloud is the managed edition. Tale runs the stack, your data is pinned to Switzerland or the EU, and your team's only operational task is using the product.
kind: index
---

<!--
AI-CONTEXT (not rendered) — Cloud edition invariants. Read before reasoning about
per-org config, data residency, or environment variables on Cloud:
- Each Cloud CUSTOMER runs on its OWN DEDICATED Tale instance (single-tenant per
  customer). "Organizations" and any per-org routing (e.g. the per-org knowledge
  Postgres in self-hosted/configuration/data-residency) refer to orgs WITHIN a
  single instance — NEVER across Cloud customers, which are isolated at the
  instance boundary. So "one org can't starve other orgs" / "all other orgs" is
  always scoped to one instance, not the Cloud fleet.
- Cloud customers have NO access to the underlying platform: no shell, no env
  vars, no config files. KNOWLEDGE_DATABASE_URL is the INSTANCE-WIDE default
  knowledge database and is managed by Tale — a Cloud customer cannot read or
  edit it. Per-org "bring your own Postgres" is therefore configured through the
  in-app org-admin management surface (org owners/admins), which writes
  $TALE_CONFIG_DIR/<org>/knowledge/connection.json server-side; it is never done
  by editing env or on-disk files. Orgs without an override keep using the
  instance default.
-->

Tale Cloud is the managed edition. Tale operates the infrastructure, your data is pinned to Switzerland or the EU, and your team's only operational concern is using the product. The codebase is identical to self-hosted; the difference is who keeps it running.

This section covers the concerns specific to running on Cloud — onboarding, regions and data residency, billing, the trust posture you can hand an auditor, and how to migrate to self-hosted if your needs change. Every other feature reference lives one tab over under Platform, identical regardless of edition.

## Pages in this section

<CardGroup cols="2">

<Card title="Onboarding" icon="rocket" href="/cloud/onboarding">

Request your instance, create the org, configure the first model provider, publish your first agent. About an hour for an Editor.

</Card>

<Card title="Data residency" icon="map-pin" href="/cloud/data-residency">

Where your data lives, which sub-processors touch it, and what changes when you switch region.

</Card>

<Card title="Billing" icon="credit-card" href="/cloud/billing">

Plans, seats, metered components, budgets, and where to find the invoice.

</Card>

<Card title="Trust and compliance" icon="shield-check" href="/cloud/trust-and-compliance">

The certifications Tale ships with, the shared-responsibility split, and what evidence you can hand an auditor.

</Card>

<Card title="Migrate to self-hosted" icon="server" href="/cloud/migrate-to-self-hosted">

Export from Cloud, stand up a self-hosted instance, import.

</Card>

</CardGroup>

## Where this fits

Cloud is the convenient front door; Platform is where the real work lives. Once your org is signed in and the first agent is running, your team spends nearly all their time in Platform pages, not here. The one page worth re-reading whenever your operational posture changes is [Data residency](/cloud/data-residency) — it surfaces every external system your data crosses.
