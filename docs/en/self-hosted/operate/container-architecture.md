---
title: Find the service behind a failure
description: Trace requests, background work, and sandbox execution to the right logs and understand automatic knowledge-index repair.
---

Use service ownership to narrow an incident before changing containers. The packaged stack combines the application and knowledge databases in `db`; source Compose can run `knowledge-db` separately. Confirm your actual layout with `tale status` or your orchestrator's service inventory.

## Choose the first logs

| Symptom | Start with | Check next |
| --- | --- | --- |
| Public URL or TLS fails | `proxy` | DNS, certificate state, public ports, upstream reachability. |
| App shell fails to load | `platform`, then `proxy` | Web health, static assets, and the selected deployment version. |
| Shell loads, but sign-in or data requests fail | `backend-api` | API health, database access, request errors, and proxy routing. |
| Jobs, scheduled automations, or ingestion stop progressing | `backend-worker` | Queue state, job errors, credentials, and required stores. |
| Reads or writes fail across the application | `db` or the external application database | Connectivity, disk space, locks, and database logs. |
| Files cannot be uploaded or downloaded | `backend-api`, then `object-store` or the external bucket | The resolved organization connection, credentials, public endpoint, and browser CORS. |
| A harness cannot start or reach its model | `sandbox`, `sandbox-llm-gateway` | Session creation, gateway authentication, model availability, and runtime image. |
| Sandboxed network access or page rendering fails | `sandbox-egress`, `sandbox` | Target hostname, allowed ports, egress policy, and session logs. |
| Video transcript retrieval fails | `backend-worker`, `bgutil-provider` | Video access, extractor errors, configured proxy, and browser-session status. |

Use logical service names with `tale logs <service>`. For your own Compose stack, use `docker compose logs --tail=200 <service>`; generated container names may include a project, colour, and replica number.

## Follow an interactive chat request

1. The browser reaches `proxy`. Web assets go to `platform`; application and authentication requests go to `backend-api`.
2. The API checks the session and organization, resolves the chosen model and credential, and executes the interactive turn. It stores progress in the application database.
3. The browser reads turn progress through the thread's stream endpoint. `/events` carries invalidation hints for refreshed data; it is not the token payload stream.
4. Knowledge tools access the requesting organization's knowledge connection. Original files are read through its storage configuration.
5. A turn using a coding harness needs a sandbox session and the model gateway. Queued tasks, workflow agent jobs, and REST chat turns can also depend on workers.

A worker outage therefore has a different scope from an API outage, but it is not safe to declare all chat or agent work unaffected. Check the entry point and execution type that failed. Preserve the original error before retrying a turn that might spend tokens or perform an external action.

## Understand the sandbox dependencies

`sandbox` is a spawner with access to the host's Docker daemon. It creates temporary containers from the pinned sandbox-runtime image and mounts their workspaces. Those sessions use an isolated network: outbound web requests pass through `sandbox-egress`, while model calls use the gateway's scoped session access.

The runtime also supplies Chromium and Playwright for page rendering and document generation. A healthy web UI does not prove that this execution plane works. Check image availability, workspace mounts, the shared sandbox token, and gateway credentials before diagnosing an individual script.

The egress service blocks private and metadata destinations and can enforce a hostname allowlist. An unavailable egress path can cause refusals or network failures; the precise error depends on the operation. [Hardening](/self-hosted/operate/security/hardening) describes the policy, and [Run Compose yourself](/self-hosted/install/own-compose) lists required capabilities and mounts.

## Recognize knowledge-index repair

A damaged BM25 index can cause ingestion failures even when the underlying document tables remain readable. The backend checks knowledge indexes with `pdb.verify_index`; an advisory lock coordinates repair attempts for a database. Organization-specific databases are checked when they are first used.

| Result | Backend behavior | Operator response |
| --- | --- | --- |
| Healthy | Continue normal work. | No repair is needed. |
| Damaged index at or below `KNOWLEDGE_INDEX_REPAIR_INLINE_MAX_BYTES` | Rebuild inline and verify again; the default limit is 1 GiB. | Allow for slower startup and inspect the final result. |
| Larger damaged index | Schedule a concurrent background rebuild; affected indexing can wait with an index-rebuilding reason. | Watch worker progress and the final verification. |
| Repair fails or verification cannot establish health | Record the failure; affected corpus operations can remain unavailable. | Inspect the exact cause, database permissions, and storage health before attempting manual repair. |

Repair events can produce `knowledge_index_repaired`, `knowledge_index_rebuild_scheduled`, or `knowledge_index_repair_failed` audit entries and administrator notifications. A failed rebuild is not proof that source documents are lost, and a successful rebuild does not replace a database backup.

`KNOWLEDGE_INDEX_REPAIR_DISABLED=1` disables the automatic check; it is not a fix for corruption. Repeated damage after restarts warrants investigating the database shutdown path and storage. Prefer normal stops with the configured grace period over forced kills. [Troubleshooting](/self-hosted/operate/observability/troubleshooting) gives the read-only index check and recovery precautions.
