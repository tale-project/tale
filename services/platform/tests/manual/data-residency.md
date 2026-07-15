# Organization data residency — Manual Test Plan

> **Purpose**: An org admin points the organization's **knowledge database**
> (Postgres/ParadeDB for extracted text + embeddings) and **object storage**
> (S3-compatible bucket for uploaded source files) at infrastructure the org
> provides — from the settings UI or the per-org JSON config — and moves
> pre-existing blobs over with the backfill. This plan proves the UI flows, the
> physical placement of data, the combination matrix (one external / both
> external / several orgs external), and that removal fails safe. Precondition:
> Mode A (full stack with a RAG backend) for anything that ingests; the UI
> flows alone also work on the hermetic stack.

## Scope & routes

| Surface                     | Route                                                  |
| --------------------------- | ------------------------------------------------------ |
| Org data residency (new)    | `/dashboard/{org}/settings/data-residency`             |
| Documents (placement proof) | `/dashboard/{org}/documents`                           |
| Deployment data residency   | `/dashboard/{org}/settings/deployment` (contrast only) |

## Prerequisites

Bring the stack up and sign in per [SETUP.md](SETUP.md) as an **org admin**.
Disposable infrastructure for the "external" side (both containers are
throwaway; pick free ports):

```bash
# External knowledge DB (ParadeDB: pgvector + pg_search)
docker run -d --name dr-kdb -p 5599:5432 -e POSTGRES_PASSWORD=drtest \
  -e POSTGRES_USER=tale -e POSTGRES_DB=tale_knowledge paradedb/paradedb:latest

# External object storage (MinIO) + a bucket
docker run -d --name dr-minio -p 9100:9000 \
  -e MINIO_ROOT_USER=testkey -e MINIO_ROOT_PASSWORD=testsecret123 \
  minio/minio server /data
docker run --rm --network host --entrypoint sh minio/mc -c \
  'mc alias set t http://127.0.0.1:9100 testkey testsecret123 && mc mb -p t/org-blobs'
```

To inspect the bucket during the run:
`docker run --rm --network host --entrypoint sh minio/mc -c 'mc alias set t http://127.0.0.1:9100 testkey testsecret123 && mc ls --recursive t/org-blobs'`

> **Agent note**: the JSON config path is the source of truth
> (`$TALE_CONFIG_DIR/{orgSlug}/knowledge/connection.json` and
> `…/{orgSlug}/object-storage/connection.json`, each with a
> `connection.secrets.json` sidecar); the panel is a writer for the same files.
> Testing the UI therefore also tests the JSON path — F7 checks the file
> directly once.

## Functional

| ID  | Test                                      | Steps                                                                                                                                                                                                                                                                                                                                                              | Expected                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Panel renders defaults                    | As an org admin open `/dashboard/{org}/settings/data-residency`                                                                                                                                                                                                                                                                                                    | Two sections: **Knowledge database** (`settings.orgDataResidency.knowledge.title`) and **Object storage** (`settings.orgDataResidency.storage.title`), each with header badge **Deployment default** (`settings.orgDataResidency.statusDefault`) and its toggle off                                                                                                                                                                 |
| F2  | BYO knowledge DB: save + test             | Enable **Knowledge database** → host `127.0.0.1`, port `5599`, database `tale_knowledge`, user `tale`, password `drtest` → **Save** → **Test connection**                                                                                                                                                                                                          | Success line appears; save toast **Saved — this organization's knowledge now lives in your database.** (`settings.orgDataResidency.knowledge.saved`). Reload: fields persist (password field is blank — write-only) and the badge is no longer **Deployment default**                                                                                                                                                               |
| F3  | BYO object storage: save + test           | Enable **Object storage** → region `us-east-1`, endpoint `http://127.0.0.1:9100`, path-style on, bucket `org-blobs`, both keys → **Save** → **Test connection**                                                                                                                                                                                                    | **Bucket verified (upload, read, delete)** (`settings.orgDataResidency.storage.verified`). Reload: config persists, key fields blank with the stored-hint (`settings.orgDataResidency.storage.credentialsHint`)                                                                                                                                                                                                                     |
| F4  | Uploads physically land in the org bucket | With F3 active: Documents → upload a small PDF → wait for the RAG badge to move past Queued (Mode A) → run the `mc ls --recursive` command above                                                                                                                                                                                                                   | The bucket lists a new object under the org's slug prefix (`[prefix/]{orgSlug}/<uuid>`); the document opens/downloads from the app; chat can cite it after indexing. In Convex dashboard the row's ref starts `s3:`                                                                                                                                                                                                                 |
| F5  | Backfill moves pre-existing blobs         | Upload one document BEFORE F3 (it lands in built-in storage), then configure F3, then run the backfill dry-run and real run: `bunx convex run object_storage/actions:startObjectStorageBlobBackfill '{"organizationId":"{org}","dryRun":true}'`, then the same with `"dryRun":false`; poll status via the panel's status query or `getObjectStorageBackfillStatus` | Dry-run reports ≥1 candidate and writes nothing (bucket unchanged). Real run completes; the pre-existing document's object appears in the bucket, the doc still opens, and its ref in Convex is rewritten to `s3:`; a second real run migrates 0 (idempotent)                                                                                                                                                                       |
| F6  | Combination matrix                        | (a) Org X: only knowledge external (F2, storage off) → upload + index a doc, ask chat about it. (b) Org X: both external (F2+F3) → repeat. (c) Second org Y on the SAME deployment: point Y at its own bucket/prefix (may be the same MinIO with a different prefix) and its own or the default DB → repeat in Y                                                   | In every combination the upload indexes, retrieval cites the doc, and placement is correct: (a) chunks in the external DB (`psql -h 127.0.0.1 -p 5599 … -c "select count(*) from private_knowledge.chunks"` grows) while the blob stays in built-in storage; (b) both external; (c) Y's objects appear ONLY under Y's namespace, X's data is untouched (`mc ls` shows disjoint prefixes; X's chunk count unchanged while Y ingests) |
| F7  | JSON config parity                        | After F3, read `$TALE_CONFIG_DIR/{orgSlug}/object-storage/connection.json` (and `connection.secrets.json`) on the convex volume                                                                                                                                                                                                                                    | The JSON matches the panel (region/endpoint/bucket/forcePathStyle); the secrets sidecar exists (SOPS-encrypted when an age key is configured, plaintext otherwise). Hand-editing the JSON (e.g. change `prefix`) is reflected in the panel after reload — same file, two writers                                                                                                                                                    |

## Boundary / error

| ID  | Test                                        | Steps                                                                                                                                                                                    | Expected                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Bad credentials fail the probe, save intact | In **Object storage** enter a wrong secret key → **Test connection**                                                                                                                     | Failure line with the mapped error (`settings.orgDataResidency.errors.invalidCredentials`); no partial state — reloading shows the last saved config                                                                                                                                                                                                 |
| B2  | Removal fails safe and is honest            | With F3 active toggle **Object storage** off → confirm dialog **Remove the object-storage connection?** (`settings.orgDataResidency.storage.clearConfirm.title`) → **Remove connection** | Toast (`settings.orgDataResidency.storage.cleared`) states new uploads go back to built-in storage AND that files already in the bucket are unavailable to Tale until reconnected. New uploads work (built-in). Documents whose ref is `s3:` now fail to open with an error — reconnecting the same bucket restores them (fail-closed, no data loss) |
| B3  | Non-admin is refused                        | Sign in as a plain member → open the route directly                                                                                                                                      | Access-denied panel (`accessDenied.orgDataResidency`); the rail entry is hidden                                                                                                                                                                                                                                                                      |
| B4  | Foreign-key isolation (shared bucket)       | With orgs X and Y on the same bucket (F6c): via the API, try to bind or read an object key of Y from X (e.g. request `/storage?ref=s3:{Y-key}&org={X}`)                                  | Refused/404 — the org-namespace guard rejects a key outside the org's own namespace on read, serve, and delete                                                                                                                                                                                                                                       |

## Accessibility

| ID  | Test              | Steps                                        | Expected                                                                                                                                         |
| --- | ----------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Keyboard + labels | Tab through the panel with the keyboard only | Every field, toggle, and button is reachable with a visible focus ring; fields have programmatic labels (the panel's axe test also asserts this) |

## Automated coverage

| Case                                                                               | Status         | Where                                                                                   |
| ---------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------- |
| Panel render / save / probe / clear / access-denied / axe                          | ✅ automated   | `app/features/settings/org-data-residency/**` (test:ui, 9 tests)                        |
| S3 verbs + presign + org-namespace guard (B4)                                      | ✅ automated   | `convex/lib/storage/object_store.integration.test.ts`, `blob_ref.test.ts` (MinIO-gated) |
| Document/audio/server-gen blobs land in the bucket                                 | ✅ automated   | `convex/lib/storage/object_storage_{documents,producers}.e2e.test.ts` (MinIO-gated)     |
| Backfill: happy / idempotent / crash-safe / shared refs / multi-org / dry-run (F5) | ✅ automated   | `convex/object_storage/backfill.e2e.test.ts` (13 cases, MinIO-gated)                    |
| External-DB retrieval incl. chat (F6a retrieval leg)                               | ✅ automated   | `tests/external-db-retrieval/external-db-retrieval.test.ts` (gated)                     |
| F4/F6 full-app placement matrix through the real UI                                | ⛔ manual-only | this plan                                                                               |
| F7 JSON parity on the volume                                                       | ⛔ manual-only | this plan                                                                               |

## Issues Found

| #   | Case | Route | Severity | Description | Screenshot |
| --- | ---- | ----- | -------- | ----------- | ---------- |
