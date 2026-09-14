---
title: Troubleshoot a self-hosted instance
description: Start with the failing action, inspect the right service, and recover without deleting data or masking the cause.
---

Record the time, affected organization, URL or action, and error code before restarting anything. Check whether the failure affects one item, one organization, or the whole deployment. That distinction determines whether to inspect a file, an organization connection, or shared infrastructure.

For a workspace deployment, start with `tale status` and `tale logs <service> --tail 200`. In your own Compose project, use `docker compose ps` and `docker compose logs --tail=200 <service>`. Service names such as `platform` and `backend-api` differ from generated container names.

## Public URL, certificate, or sign-in fails

| Symptom | Check | Next action |
| --- | --- | --- |
| Connection fails or TLS warns | DNS, public ports, certificate hostname and issuer, proxy logs. | Fix the failing layer. For an internal CA, install its public root certificate on the client; `docker exec ... caddy trust` does not change the client's trust store. |
| Proxy returns 502/503 | Identify the failing path and upstream. `/api/health` and web assets use `platform`; application requests use `backend-api`. | Inspect that service's startup error and readiness before changing proxy configuration. |
| Sign-in returns to the login page | Browser cookie and callback requests; configured `SITE_URL`, additional origins, base path, and provider registration. | Correct the mismatched origin or callback and recreate services after environment changes. |

A loading shell with empty data points first to application requests, not necessarily the web server. Inspect failed requests in the browser and `backend-api` logs. A proxy, expired session, permission refusal, and backend outage require different fixes. [TLS and domains](/self-hosted/configuration/tls-and-domains) and [Authentication](/self-hosted/configuration/authentication) cover their configuration.

## File uploads or downloads fail

Start by comparing the server's response with the browser's request to the presigned URL. A failure for one organization can come from its own storage connection even when the deployment-default bucket is healthy.

| Observation | Meaning and response |
| --- | --- |
| `object store (skipped)` at boot | The default credential pair is absent. Check `OBJECT_STORE_ACCESS_KEY` and `OBJECT_STORE_SECRET_KEY`; do not generate replacements for an existing store without coordinating its credentials. |
| `object store (ignored)` | The file is operator-managed. Inspect `default/object-storage/connection.json`; environment reconciliation deliberately leaves it alone. |
| `seeded` or `reconciled` | The default connection was written or updated from the environment. This does not prove every object permission or browser route works. |
| Store probe is down | Check endpoint, connectivity, credentials, bucket existence, and the detailed backend error. |
| Server connection test passes but browser upload fails | Check the public endpoint, certificate trust, and bucket CORS for the actual browser origin. Include `GET`, `PUT`, and `HEAD` as required by the file flow. |

`tale_backend_store_up` covers deployment defaults and measures reachability, not a complete upload. An object-store `403` can still produce an up value. Verify an actual controlled upload and download after fixing the connection. [Data residency](/self-hosted/configuration/data-residency) explains connection changes and file migration.

## A document stays unindexed

Check the document's status and failure reason, then `backend-worker` logs. Confirm the organization's embedding model and credential, vector dimensions, knowledge-database connection, and file support. A successful upload only proves that the original file was stored.

If the worker or a dependency was unavailable, restore it and inspect whether the job resumes or needs **Index now** in [Knowledge](/platform/knowledge/documents). For a corrupt, encrypted, or unsupported source file, correct the source before retrying. Do not delete a document as the first diagnostic step: its identity, history, and references may matter.

## Knowledge Postgres crashes during ingestion

Repeated `PANIC: corrupted page pointers` or `signal 6` errors can indicate a damaged BM25 index. Inspect the database logs and the automatic repair result described in [Container architecture](/self-hosted/operate/container-architecture#recognize-knowledge-index-repair). Confirm the exact corpus database; in the packaged stack it is `tale_knowledge` inside `db`, while other deployments use a separate service or external host.

From an authorized SQL session on that database, this query only verifies the named index:

```sql
SELECT * FROM pdb.verify_index('private_knowledge.idx_pk_chunks_bm25');
```

A missing function, permission error, or timeout is not the same as a confirmed corrupt index. If damage is confirmed and automatic repair did not succeed, preserve a backup and plan a database maintenance operation. Rebuilding a derived index is different from deleting document tables:

```sql
REINDEX INDEX private_knowledge.idx_pk_chunks_bm25;
```

The non-concurrent command can block work. Coordinate it with your database operator, verify the index again afterward, and check ingestion recovery. Do not run speculative reindex or extension-installation commands against the wrong database. Repeated corruption warrants checking disk health and whether shutdowns are being forced past the configured grace period.

## Chat or an automation stops

Check the run or chat error and the owning API/worker logs. A provider `429`, credential refusal, execution timeout, approval wait, and disconnected browser stream are distinct states. An approval wait needs a decision, not a service restart. A disconnected stream can hide an operation that still runs; inspect its stored result before retrying.

For provider failures, check the selected credential's quota and permissions, and the provider's status. Change models only if the replacement is allowed and suitable for the task. For harness failures, inspect `sandbox`, `sandbox-llm-gateway`, the runtime image, and session logs.

## Sandbox network access is refused

Inspect `sandbox-egress` and the target URL. A configured `SANDBOX_EGRESS_ALLOWLIST` must include the required hostname; private and cloud-metadata targets remain blocked. HTTPS tunnels use the supported port policy. Confirm the intended destination before broadening an allowlist, then recreate the egress service when changing its environment.

A healthy egress process does not prove that the remote host, DNS, certificate, or account is available. Keep the specific request error with the incident report.

## Writes fail or storage fills up

Check application-database connectivity, free space, connection usage, and locks. Stop avoidable growth and follow your database procedure to recover capacity. Do not delete volume contents, reset encryption keys, or assume failed writes will replay after a restart. Retry the original operation only after checking whether it persisted.

When seeking help, include versions, sanitized errors, time range, affected scope, and reproduction steps. `tale diagnostics` collects a diagnostic bundle; inspect it before sharing because deployment details can still be sensitive. Report reproducible defects through the [project issue tracker](https://github.com/tale-project/tale/issues).
