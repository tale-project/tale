---
title: Cryptography and key ownership
description: Identify the encryption, password and audit keys your deployment depends on, and plan their recovery.
---
Use this inventory to determine which key protects each kind of data and what happens if that key changes. Application secrets, database volumes, network traffic and audit evidence have separate controls. Keep those controls distinct when designing a backup or reviewing a deployment.

## Identify encrypted data

Current provider credentials use the database secret box: AES-256-GCM with a purpose-specific key derived from `ENCRYPTION_SECRET_HEX` through HKDF-SHA256. Other database credentials, including connector OAuth tokens, can use the JWE `dir`/`A256GCM` path backed by the same deployment root. These formats are not interchangeable.

Supported configuration secret sidecars use SOPS with age recipients. This includes external knowledge and object-storage connection secrets. SOPS encryption is configured by `SOPS_AGE_KEY` or `SOPS_AGE_KEY_FILE`; without either, the helper supports plaintext files with restricted permissions. See [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops) before changing that setting.

Names, addresses, conversations and document content do not receive blanket field-level encryption from those secret mechanisms. Protect the database, object storage and backups with the storage encryption and access controls required for your deployment. TLS protects traffic, not a database file copied from disk.

## Protect network traffic

The public reverse proxy terminates HTTPS. Set the correct domain and certificate source using [TLS and domains](/self-hosted/configuration/tls-and-domains), then verify the certificate and accepted TLS versions on the deployed endpoint.

Internal Docker networking separates services but is not itself TLS encryption. If your database, object store or other dependency crosses hosts or trust boundaries, configure and verify transport protection for that connection too.

## Preserve password and session controls

Local passwords are hashed with bcrypt. `BETTER_AUTH_SECRET` protects authentication state; keep it stable and consistent across the backend replicas. Changing it can invalidate sessions and disrupt active authentication flows.

An identity provider has its own signing keys and rotation process. Register its current metadata and certificates through [Enterprise SSO](/platform/admin/enterprise-sso); rotating a Tale session secret does not rotate an IdP key.

## Verify audit evidence

Audit entries form a SHA-256 chain. The current PostgreSQL verifier checks retained rows and their links, starting from the first surviving stored link. It accounts for retention and checks scrubbed rows against erasure requests. It does not verify signed checkpoints or use `TALE_AUDIT_SIGNING_KEY` as an independent trust anchor.

A chain is tamper-evident, not tamper-proof storage. Protect database access, retain evidence independently where needed and investigate an alert through [Audit-log integrity](/self-hosted/operate/security/audit-log-integrity). The separate `TALE_AUDIT_PEPPER` pseudonymizes sensitive failed-sign-in identifiers; rotating it changes correlation across that boundary.

## Plan key recovery

Use this table when assembling a restore plan:

| Control | Keep with the recovery plan | If it changes or is lost |
| --- | --- | --- |
| Database secret encryption | `ENCRYPTION_SECRET_HEX` matching the snapshot | Existing encrypted credentials may no longer decrypt. |
| SOPS sidecars | Matching private age keys, including keys for old backups | Files addressed only to a lost recipient cannot be read. |
| Authentication | `BETTER_AUTH_SECRET` and consistent deployment configuration | Existing sessions and active sign-in flows may stop working. |
| Audit verification | Retained audit rows, erasure records and independent evidence | Lost or rewritten history cannot be established from the current chain alone. |
| Host and managed storage encryption | The storage provider’s recovery material and access | Application keys alone cannot unlock the volume or bucket. |

Keep keys in a secret manager or protected recovery store, separate from publicly accessible source and build artifacts. Retain old decryption keys for old backups even after the active deployment rotates. Test a restore with the actual key material in an isolated environment.

For organization certifications and assurance documents, use [Trust and compliance](/cloud/trust-and-compliance). This implementation inventory explains the technical controls; evaluate the configuration of your own installation alongside those materials.
