---
title: Data residency
description: Where your Cloud data lives, where it moves during a single chat, which sub-processors touch it, and what stays in region versus what leaves.
---

Data residency on Cloud answers two questions every audit eventually asks: which region holds your data at rest, and which external systems touch it in flight. This page traces a single chat round-trip end to end, lists the data classes, and names every sub-processor your messages pass through.

The default region for new Cloud orgs is Switzerland. Switching region after sign-up is a migration, not a setting flip — re-creating an org in the EU region is faster than moving an existing one. Pick once; pick deliberately.

## A worked example — one chat round-trip

The user in Zürich opens Chat and sends "summarise the latest customer call". The request hits Tale's edge in the chosen region, lands on `tale-platform`, which forwards it to `tale-backend-api` (the backend), reads knowledge from the corpus database when the agent's knowledge tool asks for it, and emits an outbound call to the provider behind the model the sender picked. Knowledge retrieval runs inside the backend — it queries the corpus database directly, with no separate retrieval service in the path. The model provider returns tokens; Tale streams them back across the same path. The reply and citations land in the operational database, the corpus stays in the knowledge database, and both are replicated within the region.

Two arrows cross the regional boundary in this trip: the call to the model provider (always external) and any sub-processor the agent's tools triggered (web fetch, OneDrive read, MCP server in another region). Everything else stays in region.

## Primary regions

| Region         | Postgres  | Object store | DR replica |
| -------------- | --------- | ------------ | ---------- |
| Switzerland    | Zürich    | Zürich       | Geneva     |
| European Union | Frankfurt | Frankfurt    | Dublin     |

The DR replica is for disaster recovery, not active traffic. A region's data never flows to the other region's primary or replica.

## What stays in region, what leaves

| Data type                          | Region-locked | Crosses | Notes                                                                          |
| ---------------------------------- | ------------- | ------- | ------------------------------------------------------------------------------ |
| Chats and messages                 | ✓             |         |                                                                                |
| Documents and knowledge embeddings | ✓             |         |                                                                                |
| Org configuration and roles        | ✓             |         |                                                                                |
| Audit logs                         | ✓             |         |                                                                                |
| Model provider requests            |               | ✓       | Goes to the provider you configured; pick a regional endpoint when one exists. |
| OneDrive sync                      |               | ✓       | Microsoft's storage region applies.                                            |
| Web tool fetches                   |               | ✓       | Wherever the URL resolves.                                                     |

## Backups and DR

Tale snapshots both Postgres databases — the operational store and the knowledge corpus — daily, and the object store hourly. Snapshots are encrypted at rest with keys held by Tale; the DR replica receives a copy within the region. Restores from snapshot are a customer-initiated operation routed through support; the SLA covers restore time.

## Changing region

A region change is implemented as an export from the current region, an import into the new region, and a DNS cutover. The procedure is the same as [Migrate to self-hosted](/cloud/migrate-to-self-hosted) except both sides are Cloud regions; expect downtime in the minutes range and a planned window. There is no in-place region toggle.

## Where this fits

Data residency is the first page every compliance review reads. Pair it with [Trust and compliance](/cloud/trust-and-compliance) (which framework covers what) and [Subprocessors](/legal/subprocessors) (the list of every external system named above). If your org is considering self-hosted because of a residency requirement, [Self-hosted overview](/self-hosted/overview) is the next read — running the stack on your hardware moves every arrow on this page inside your own boundary.
