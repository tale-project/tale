---
title: Self-hosted architecture
description: Understand the application, storage, and sandbox services before choosing how to deploy and operate Tale.
---

A self-hosted Tale deployment runs the application, its storage, and the sandbox services on infrastructure you operate. One deployment can contain several organizations; each organization's records and configuration remain scoped to that organization.

Start with this map when planning capacity or deciding which data to back up. [Run Compose yourself](/self-hosted/install/own-compose) describes the exact network, mount, and health-probe contract. [Container architecture](/self-hosted/operate/container-architecture) helps locate a failure in a running instance.

## How the services fit together

The packaged single-host stack has ten services before replicas and temporary sandbox sessions are counted. The contributor stack can use a separate knowledge database. Service names are more useful than container counts when comparing those layouts.

| Layer | Services | Responsibility |
| --- | --- | --- |
| Public entry point | `proxy` | Caddy terminates TLS and routes the browser to the web tier, APIs, and file storage. |
| Application | `platform`, `backend-api`, `backend-worker` | The web tier serves the UI; the API authenticates requests and serves application operations; workers process queued tasks, automations, and ingestion. |
| Persistent storage | `db`, `object-store` | Postgres holds application and knowledge data; the S3-compatible store holds original files and generated media. |
| Sandboxed execution | `sandbox`, `sandbox-egress`, `sandbox-llm-gateway` | The spawner creates execution sessions, the egress proxy controls outbound requests, and the model gateway supplies scoped model access. |
| Video support | `bgutil-provider` | Supplies proof-of-origin tokens for video ingestion. Its availability can affect transcript retrieval. |

The browser connects through the public proxy. Internal database, gateway, and sandbox ports should not be exposed as public services. With an external bucket, presigned file requests can instead go directly from the browser to that bucket's public endpoint.

The application roles use the same Tale platform image. `TALE_ROLE=api` starts the API; `TALE_ROLE=worker` starts a worker. Workers do not expose an HTTP server. The sandbox runtime is a separate image used to create temporary session containers, rather than another permanently running Compose service.

## Where persistent data lives

| Location in the packaged stack | Data to preserve |
| --- | --- |
| `db-data` | `tale_app`: users, chats, runs, audit records, and encrypted database secrets. `tale_knowledge`: extracted content, embeddings, search indexes, and crawled pages. |
| `config-data` | Organization configuration files, including agents, skills, provider definitions, governance settings, SSO configuration, and branding. |
| `object-store-data` | Uploaded documents, attachments, audio, and generated files. |
| `caddy-data`, `caddy-config` | Certificates and proxy state. |
| `llm-gateway-data` | Gateway configuration and session access state. |

The packaged stack puts the two databases in one Postgres service and exposes its knowledge connection through the `knowledge-db` network alias. They remain separate databases. A source Compose deployment with a separate knowledge service also has `knowledge-db-data`.

Replacing a container preserves data only if its persistent volumes or external stores remain attached. Keep the deployment workspace, environment, encryption keys, and off-host backups as well. The CLI's snapshot inventory is narrower than every volume above; check [Backups and restore](/self-hosted/operate/backups-and-restore) before relying on it.

## Secrets and sign-in

`ENCRYPTION_SECRET_HEX` protects provider credentials and other encrypted values in the application database. SOPS and age protect supported configuration secret sidecars, such as external storage passwords. Back up the required keys separately from the data they protect; replacing a key does not decrypt existing secrets.

Better Auth runs in the backend. Local sign-in, two-factor authentication, passkeys, enterprise SSO, and trusted-header authentication have different setup requirements. Use [Authentication](/self-hosted/configuration/authentication) to choose the applicable route, and [Members and roles](/platform/admin/members-and-roles) for organization permissions.

## Capacity and isolation choices

Application roles can have multiple replicas. The CLI rolls them as one versioned group; upgrades temporarily run both old and new groups, so allow capacity for that overlap. The database, object store, and sandbox plane need their own capacity and recovery plan.

You can move the application database, knowledge database, or blob storage to external infrastructure. An organization can also select its own knowledge database and bucket. Changing a connection does not migrate existing content: plan the copy, cutover, verification, and backup coverage using [Data residency](/self-hosted/configuration/data-residency).

Self-hosting controls where Tale runs. Provider calls, connectors, web retrieval, and sandbox network access still depend on your configuration. Review those destinations alongside storage placement in [Hardening](/self-hosted/operate/security/hardening).
