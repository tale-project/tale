---
title: Cryptography
description: The algorithms Tale uses for data at rest, data in transit, password hashing, and audit-log integrity — and how they map to BSI TR-02102-1.
---

This page is the inventory of every cryptographic primitive Tale relies on: what protects secrets on disk, what protects traffic on the wire, how passwords are hashed, and how the audit log proves it has not been tampered with. It is written for operators and compliance reviewers who need to answer "which algorithms, which key lengths, where are the keys" against a standard such as BSI TR-02102-1 — Tale already uses compliant primitives, and this page is where they are written down.

The claims here are verified against the source; where a primitive is configurable, the environment variable that controls it is named so you can audit your own deployment. None of this is a substitute for encrypting the host disk — see [Hardening](/self-hosted/operate/security/hardening) for the layer below the application.

## Data at rest

Tale encrypts two classes of secret at rest, with two different mechanisms.

**Provider API keys** live in `providers/*.secrets.json` and are encrypted with [SOPS](/self-hosted/configuration/secrets-with-sops) using an **age** key. SOPS encrypts each value with **AES-256-GCM** and wraps the data key to the age recipient, whose key agreement is **X25519**. An encrypted value reads `ENC[AES256_GCM,data:…,iv:…,tag:…]` on disk; decryption happens in-process and the age private key never leaves the backend container's memory — it is the only tier that reads the config store's secrets.

**Application-encrypted fields** — OAuth connector tokens and similar credentials stored in the database — are encrypted with **AES-256-GCM** through a compact JWE (`alg: dir`, `enc: A256GCM`). The 32-byte key comes from `ENCRYPTION_SECRET` (base64) or `ENCRYPTION_SECRET_HEX` (hex); the platform refuses to start the encryption path with a key that is not exactly 32 bytes.

The Postgres volumes and the blob store are protected by the host: run them on an encrypted filesystem (LUKS, or your cloud provider's volume encryption). Tale does not store credentials in plaintext — a provider key or OAuth token is either SOPS-encrypted on disk or AES-256-GCM-encrypted in the database, never written in the clear.

**Customer PII and application records** — names, email and postal addresses, conversation content — are protected by the layers that protect the database as a whole: the encrypted host filesystem at rest, TLS 1.3 in transit, and an organisation scope the backend applies to every read. Be precise about the first of those: Postgres stores these rows unencrypted, so the encryption at rest is the volume's, not the database's. If your regime requires the database itself to hold ciphertext, that is a managed-Postgres or filesystem decision you make below Tale.

Application-level field encryption is purpose-built for secrets — provider keys and OAuth tokens, written once and read by a single code path. PII is different: it is filtered, sorted, and looked up by exact value, and the customer table is indexed by organisation and email. Encrypting those columns at the field level would break equality lookups and indexed search — unless paired with a searchable-hash scheme that leaks the very equality it is meant to hide — while adding a key-rotation cost and no protection the encrypted host disk beneath the application doesn't already provide against a stolen volume.

If your compliance regime calls for field-level PII encryption on top of these layers, that is a deliberate application change rather than a default Tale ships.

## Data in transit

All browser and API traffic terminates TLS at the reverse proxy (Caddy), which negotiates TLS 1.3 (with TLS 1.2 as the floor) and obtains certificates automatically. The cipher suites are the proxy's modern defaults — AES-256-GCM and ChaCha20-Poly1305 with ECDHE key exchange. Configure the domain and certificate source in [TLS and domains](/self-hosted/configuration/tls-and-domains); traffic between containers stays on the host's internal Docker network.

## Password hashing

Local-password accounts are hashed with **bcrypt** (via Better Auth), so a stolen database row does not reveal the password and a verification deliberately costs ~100 ms — which is also why the login path's timing is fuzzed (see [Authentication](/self-hosted/configuration/authentication)). Sessions are signed with `BETTER_AUTH_SECRET` (HMAC); rotating that secret invalidates every existing session.

## Audit-log integrity

The audit log is tamper-evident through a **SHA-256 hash chain**: each entry stores `SHA-256(previousHash + canonicalized record)`, so altering or deleting any historical entry breaks the chain at that point and every entry after it. Entries additionally carry an **HMAC-SHA-256** signature. The admin integrity-check verifies both; see [Audit logs](/platform/admin/governance/audit-logs).

## Mapping to BSI TR-02102-1

Every primitive below is in the recommended set of BSI TR-02102-1. Tale does not ship any deprecated algorithm (no MD5, SHA-1, DES, or RSA &lt; 3072 on a key it generates).

| Use                     | Algorithm                         | Key / output size | Controlled by                                 |
| ----------------------- | --------------------------------- | ----------------- | --------------------------------------------- |
| Provider secrets (disk) | AES-256-GCM + age (X25519)        | 256-bit           | `SOPS_AGE_KEY` / `SOPS_AGE_KEY_FILE`          |
| App fields (database)   | AES-256-GCM (JWE `dir`/`A256GCM`) | 256-bit           | `ENCRYPTION_SECRET` / `ENCRYPTION_SECRET_HEX` |
| Transport               | TLS 1.3 (AES-256-GCM, ECDHE)      | 256-bit           | Reverse proxy / `tls-and-domains`             |
| Password hashing        | bcrypt                            | per-hash salt     | Better Auth (built in)                        |
| Session signing         | HMAC-SHA-256                      | 256-bit           | `BETTER_AUTH_SECRET`                          |
| Audit integrity         | SHA-256 chain + HMAC-SHA-256      | 256-bit           | built in                                      |

## Key storage and rotation

Three secrets are load-bearing, and each has a rotation path. The **age private key** (`SOPS_AGE_KEY`) decrypts provider secrets; rotate it by adding a new recipient and re-encrypting, following the walk in [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops). The **field-encryption key** (`ENCRYPTION_SECRET`) decrypts database credentials; rotating it requires re-encrypting the affected rows, so plan it as a maintenance step rather than a hot swap. The **auth secret** (`BETTER_AUTH_SECRET`) signs sessions; rotating it logs everyone out on their next request. All three live only in the platform container's environment — never commit them, and store them in your secret manager of record.

## Where this fits

Cryptography in Tale is layered: SOPS+age and AES-256-GCM protect secrets at rest, TLS 1.3 protects them in transit, bcrypt protects passwords, and a SHA-256 chain proves the audit log is intact — all primitives that sit inside BSI TR-02102-1's recommended set, with the controlling environment variables named above so you can verify your own instance.

The layer beneath the application is the host itself: [Hardening](/self-hosted/operate/security/hardening) covers the egress allowlist, container isolation, and disk-encryption expectations that this page assumes, and [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops) is the operational walk-through for the age key these algorithms depend on.
