---
title: Backups and restore
description: Volume snapshots via `tale backup`, the automatic pre-migration snapshot, retention, the off-host copy, and the `tale restore` drill.
---

Tale's backup unit is the volume snapshot: a paused, checksummed tar of the instance's core data volumes, written into a dedicated `backups` volume that lives next to the data it protects. The CLI takes one automatically before any deploy step that can migrate data, and `tale backup` takes one on demand. Recovery is `tale restore <snapshot-id>` plus a redeploy of the matching version — that pair is the answer to a failed upgrade, and the reason `tale rollback` can afford to refuse anything beyond a patch step.

The architecture context lives in [Container architecture](/self-hosted/operate/container-architecture); this page covers what a snapshot contains, when one is taken, how the copy gets off the host, and the restore walk.

## What a snapshot contains

| Volume                       | Holds                                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `db-data`                    | Postgres — the application store (agents, runs, the audit log) and the knowledge corpus (document chunks, embeddings, crawled pages)    |
| `convex-data`                | Org config, provider secrets, uploaded branding                                                                                         |
| `object-store-data`          | The blob store — uploaded files, chat attachments, audio, generated media — whenever the deployment default is the bundled object store |
| `caddy-data`, `caddy-config` | TLS certificates and proxy state                                                                                                        |

Each snapshot is a directory named like `20260611-142530-deploy` inside the project's `backups` volume: one `.tar.gz` per volume, a `.sha256` sidecar each, and a `manifest.json` written last. A directory without a manifest is an incomplete snapshot — it never shows up in listings and can never be restored, and rotation deletes it on the next `tale deploy` or `tale backup` once a newer complete snapshot exists. Two things live outside the volumes entirely and need their own place in your off-host job: the project workspace (the directory holding `tale.json`) and `.env`.

Blobs follow the object store. With the bundled `object-store` — the default — `object-store-data` is captured like every other volume, and its archive is as large as everything ever uploaded: the store is paused while it is tarred, so uploads and downloads stall for that long. Two cases put blobs outside the snapshot, and both are announced rather than silent. A deployment default repointed at an external S3 (`default/object-storage/connection.json` no longer naming the bundled store) leaves the local volume with nothing the app reads, so the volume is skipped and `tale backup` prints a one-line notice with the endpoint and bucket — that bucket's backup runs under your own S3 tooling. An organization that brings its own bucket under **Settings > Data residency** never writes to the local volume either; the notice names the organization, and no snapshot can contain those blobs.

## When snapshots are taken

`tale deploy` snapshots before its first mutating step whenever the deploy can change data: the target version differs from the running one, or a host-config push (`--override` / `--override-all`) is requested. While each volume is tarred, the containers using it are paused for the duration — seconds for the database and config volumes, as long as the store is large for the blob volume — so the archive is crash-consistent: a live copy of a running Postgres directory is not restorable.

A failed snapshot aborts the deploy. `--skip-backup` overrides that on `tale deploy`, which leaves your own external backups as the only recovery path — the flag logs a loud warning for exactly that reason.

```bash
# Take a snapshot right now
tale backup
```

## Retention

Rotation keeps the newest five snapshots and everything from the last 14 days — whichever is more generous. A snapshot is deleted only when it is both beyond the count window and older than the age window, so a quiet instance keeps its last snapshots indefinitely. Override the windows with `BACKUP_KEEP_COUNT` and `BACKUP_KEEP_DAYS` in `.env`.

## Off-host copy

The snapshots live on the same host as the data they protect — a dead disk takes both. Point your existing backup tooling (Restic, Borg, Velero, cloud-provider snapshots) at the `backups` volume, and capture the project workspace and `.env` in the same job. Tale does not ship an upload step — keeping the off-host copy under your existing backup contract is deliberate.

```bash
# crontab on the host — hourly Restic copy of the backups volume to S3
0 * * * * restic -r s3:s3.amazonaws.com/bucket/tale backup \
  /var/lib/docker/volumes/<project-id>_backups/_data
```

Find the volume's host path with `docker volume inspect <project-id>_backups`; the project id lives in `tale.json`.

## Restoring a snapshot

`tale restore` without arguments lists what is available; with an id it verifies the checksums, wipes the data volumes, and extracts the snapshot. It refuses while any project container runs — pass `--stop` to stop them — and asks for confirmation before touching anything.

```bash
# See what's available
tale restore

# Stop the stack and restore
tale restore 20260611-142530-deploy --stop

# Bring the stack back on the version that matches the data
tale update --version 0.9.6
tale deploy --stop
```

The redeploy of the matching version is part of the restore, not an optional extra: the snapshot captured the data exactly as that platform version left it, and a newer binary would immediately re-run its migrations against it. The restore output prints the exact version recorded in the snapshot's manifest.

A snapshot taken before blobs were captured, or on a deployment whose blobs live in external S3, has no `object-store-data` archive. `tale restore` lists such snapshots as `without blobs`, says so again before asking for confirmation, and leaves the blob volume untouched while it restores everything else — the blobs stay exactly as they are on the host.

## Restore drill

Run the drill quarterly on a non-production host. The drill is not "does a snapshot exist" — it is "can a fresh host be rebuilt from the off-host copy of the `backups` volume, the project workspace, and `.env` in under an hour." The failure modes the drill catches: an off-host job that never captured the workspace, and a stale `.env` that no longer matches the current binary's requirements.

## Where this fits

Snapshots are the cheap part; the restore drill is what proves they work, and the redeploy-the-matching-version rule is the one thing to remember — recovery is never "roll the binary back," it is "restore the data and deploy the version it belongs to." The upgrade flow these snapshots protect lives in [Upgrades](/self-hosted/operate/upgrades); the hardening checklist that names backups as a row is in [Hardening](/self-hosted/operate/security/hardening).
