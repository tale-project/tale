---
title: Self-hosted architecture
description: Understand the application, storage, and sandbox services before choosing how to deploy and operate Tale.
---

A self-hosted Tale deployment runs the application, its storage, and the sandbox services on infrastructure you operate. One deployment can contain several organizations; each organization's records and configuration remain scoped to that organization.

Start with this map when planning capacity or deciding which data to back up. [Run Compose yourself](/self-hosted/install/own-compose) describes the exact network, mount, and health-probe contract. [Container architecture](/self-hosted/operate/container-architecture) helps locate a failure in a running instance.

## How the services fit together

The packaged single-host stack has seven services before replicas and temporary sandbox sessions are counted, the application being one of them. A deployment that runs the application's roles apart has up to two more, and the contributor stack can use a separate knowledge database. Service names are more useful than container counts when comparing those layouts.

| Layer | Services | Responsibility |
| --- | --- | --- |
| Public entry point | `proxy` | Caddy terminates TLS and routes the browser to the web tier, APIs, and file storage. |
| Application | `platform`; also `backend-api` and `backend-worker` where the roles run apart | The web tier serves the UI; the API authenticates requests and serves application operations; workers process queued tasks, automations, and ingestion. One `platform` process is all three unless the roles run apart. |
| Persistent storage | `db`, `object-store` | Postgres holds application and knowledge data; the S3-compatible store holds original files and generated media. |
| Sandboxed execution | `sandbox`, `sandbox-egress` | The spawner creates execution sessions and the egress proxy controls outbound requests. The agents in those sessions call their models through the [model relay](/self-hosted/configuration/environment-reference#model-relay) that the API runs. |
| Video support | `bgutil-provider` | Supplies proof-of-origin tokens for YouTube links. `tale deploy` starts it only where `VIDEO_INGEST_POT_PROVIDER=true`. |

The browser connects through the public proxy. Internal database, model relay, and sandbox ports should not be exposed as public services. With an external bucket, presigned file requests can instead go directly from the browser to that bucket's public endpoint.

The application roles use the same Tale platform image, and `TALE_ROLE` decides which of them a container runs. A workspace deployed with `tale deploy` starts `platform` with `TALE_ROLE=all`: one process is the web tier, the API and the workers. Setting a backend replica count runs the workers apart, as `backend-worker` (`TALE_ROLE=worker`) beside a `platform` that is the web tier and the API (`TALE_ROLE=api`); [Upgrades](/self-hosted/operate/upgrades#one-process) names the variables. The Compose file in the repository, the Kubernetes manifests and the Incus runtime run three services: `platform` as the web tier alone, `backend-api` and `backend-worker`. Workers do not expose an HTTP server. The sandbox runtime is a separate image used to create temporary session containers, rather than another permanently running Compose service.

## Where persistent data lives

| Location in the packaged stack | Data to preserve |
| --- | --- |
| `db-data` | `tale_app`: users, chats, runs, audit records, and encrypted database secrets. `tale_knowledge`: extracted content, embeddings, search indexes, and crawled pages. |
| `config-data` | Organization configuration files, including agents, skills, provider definitions, governance settings, SSO configuration, and branding. |
| `blob-data` | Uploaded documents, attachments, audio, and generated files. A deployment installed before versitygw keeps them in `object-store-data` until [they move](/self-hosted/operate/upgrades#blob-store). |
| `caddy-data`, `caddy-config` | Certificates and proxy state. |

The packaged stack puts the two databases in one Postgres service and exposes its knowledge connection through the `knowledge-db` network alias. They remain separate databases. A source Compose deployment with a separate knowledge service also has `knowledge-db-data`. A deployment that ran the model gateway of an earlier release keeps its store, `llm-gateway-data`, until you remove it, as [Upgrades](/self-hosted/operate/upgrades#model-relay) describes.

Replacing a container preserves data only if its persistent volumes or external stores remain attached. Keep the deployment workspace, environment, encryption keys, and off-host backups as well. The CLI's snapshots cover these volumes but no external store, and skip the blob volume when the deployment default points at an external bucket; check [Backups and restore](/self-hosted/operate/backups-and-restore) before relying on them.

## Secrets and sign-in

`ENCRYPTION_SECRET_HEX` protects provider credentials and other encrypted values in the application database. SOPS and age protect supported configuration secret sidecars, such as external storage passwords. Back up the required keys separately from the data they protect; replacing a key does not decrypt existing secrets.

Better Auth runs in the backend. Local sign-in, two-factor authentication, passkeys, enterprise SSO, and trusted-header authentication have different setup requirements. Use [Authentication](/self-hosted/configuration/authentication) to choose the applicable route, and [Members and roles](/platform/admin/members-and-roles) for organization permissions.

## Capacity and isolation choices

Application roles can have multiple replicas. The CLI rolls them as one versioned group; upgrades temporarily run both old and new groups, so allow capacity for that overlap. The database, object store, and sandbox plane need their own capacity and recovery plan.

You can move the application database, knowledge database, or blob storage to external infrastructure. An organization can also select its own knowledge database and bucket. Changing a connection does not migrate existing content: plan the copy, cutover, verification, and backup coverage using [Data residency](/self-hosted/configuration/data-residency).

Self-hosting controls where Tale runs. Provider calls, connectors, web retrieval, and sandbox network access still depend on your configuration. Review those destinations alongside storage placement in [Hardening](/self-hosted/operate/security/hardening).
