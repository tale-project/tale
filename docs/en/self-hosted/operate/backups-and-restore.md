---
title: Backups and restore
description: Volume snapshots via `tale backup`, the automatic pre-migration snapshot, retention, the off-host copy, and the `tale restore` drill.
---

Tale's backup unit is the volume snapshot: a paused, checksummed tar of the database, the org config tree, and the proxy state, written into a dedicated `backups` volume that lives next to the data it protects. The CLI takes one automatically before any deploy step that can migrate data, and `tale backup` takes one on demand. Recovery is `tale restore <snapshot-id>` plus a redeploy of the matching version — that pair is the answer to a failed upgrade, and the reason `tale rollback` can afford to refuse anything beyond a patch step.

A snapshot is not the whole instance. Uploaded file blobs sit outside it, so the off-host job below is what makes a full rebuild possible — read that section even if you never take a manual snapshot.

The architecture context lives in [Container architecture](/self-hosted/operate/container-architecture); this page covers what a snapshot contains, what it leaves to you, when one is taken, how the copy gets off the host, and the restore walk.

## What a snapshot contains

| Volume                       | Holds                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `db-data`                    | Postgres — the application database (chats, tasks, automation runs, the audit log) and, on a single-host `tale deploy` stack where both databases share one Postgres, the knowledge corpus |
| `convex-data`                | The org config tree — agents, automations, connectors, providers, skills, governance policies, SSO connections, branding |
| `caddy-data`, `caddy-config` | TLS certificates and proxy state                                                               |

`convex-data` is the config volume's historical name. It is kept deliberately so that retiring the Convex backend did not force every operator to migrate a volume for a rename; nothing Convex-related runs in it.

Each snapshot is a directory named like `20260611-142530-deploy` inside the project's `backups` volume: one `.tar.gz` per volume, a `.sha256` sidecar each, and a `manifest.json` written last. A directory without a manifest is an incomplete snapshot — it never shows up in listings and can never be restored.

<Warning>

**Uploaded files are not in the snapshot.** Document blobs, chat attachments, audio, and generated media live in the blob store on the `object-store-data` volume, and `tale backup` does not capture it. A restore therefore brings back rows that reference blobs the store no longer has — the app renders the document list and fails on open. Capture `object-store-data` in the same job that copies the `backups` volume off the host, or point the deployment at an object store that carries its own backups.

</Warning>

Three more things live outside the snapshotted volumes and need separate capture: the blob store above, the project workspace (the directory holding `tale.json`), and `.env`.

## When snapshots are taken

`tale deploy` snapshots before its first mutating step whenever the deploy can change data: the target version differs from the running one, or a host-config push (`--override` / `--override-all`) is requested. While each volume is tarred, the containers using it are paused for a few seconds so the archive is crash-consistent — a live copy of a running Postgres directory is not restorable.

A failed snapshot aborts the deploy. `--skip-backup` overrides that on `tale deploy`, which leaves your own external backups as the only recovery path — the flag logs a loud warning for exactly that reason.

```bash
# Take a snapshot right now
tale backup
```

## Retention

Rotation keeps the newest five snapshots and everything from the last 14 days — whichever is more generous. A snapshot is deleted only when it is both beyond the count window and older than the age window, so a quiet instance keeps its last snapshots indefinitely. Override the windows with `BACKUP_KEEP_COUNT` and `BACKUP_KEEP_DAYS` in `.env`.

## Off-host copy

The snapshots live on the same host as the data they protect — a dead disk takes both. Point your existing backup tooling (Restic, Borg, Velero, cloud-provider snapshots) at the `backups` volume **and** at `object-store-data`, and capture the project workspace and `.env` in the same job. Tale does not ship an upload step — keeping the off-host copy under your existing backup contract is deliberate.

```bash
# crontab on the host — hourly Restic copy of the snapshots and the blob store
0 * * * * restic -r s3:s3.amazonaws.com/bucket/tale backup \
  /var/lib/docker/volumes/<project-id>_backups/_data \
  /var/lib/docker/volumes/<project-id>_object-store-data/_data
```

Find a volume's host path with `docker volume inspect <project-id>_backups`; the project id lives in `tale.json`.

## Restoring a snapshot

`tale restore` without arguments lists what is available; with an id it verifies the checksums, wipes the volumes the snapshot covers, and extracts the snapshot. It refuses while any project container runs — pass `--stop` to stop them — and asks for confirmation before touching anything. It restores only the volumes listed in the table above; the blob store is yours to restore from the off-host copy, before you bring the stack back up.

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

## Restore drill

Run the drill quarterly on a non-production host. The drill is not "does a snapshot exist" — it is "can a fresh host be rebuilt from the off-host copy of the `backups` volume, the blob store, the project workspace, and `.env` in under an hour." Finish by opening a document that was uploaded before the snapshot: that is the one step that proves the blob store came back with the database, and it is the step a snapshot-only drill skips. The other failure modes the drill catches: an off-host job that never captured the workspace, and a stale `.env` that no longer matches the current binary's requirements.

## Where this fits

Snapshots are the cheap part; the restore drill is what proves they work, and the redeploy-the-matching-version rule is the one thing to remember — recovery is never "roll the binary back," it is "restore the data and deploy the version it belongs to." The upgrade flow these snapshots protect lives in [Upgrades](/self-hosted/operate/upgrades); the hardening checklist that names backups as a row is in [Hardening](/self-hosted/operate/security/hardening).
