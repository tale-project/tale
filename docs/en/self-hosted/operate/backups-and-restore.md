---
title: Backups and restore
description: Plan the complete recovery set, create and copy CLI snapshots, then restore data with its matching Tale version.
---

A recoverable Tale instance needs more than a database archive: keep its files, organization configuration, deployment workspace, and decryption keys together with the version that wrote them. Set your recovery-point and recovery-time objectives first, then test whether your backup schedule and restore procedure meet them.

This guide covers the workspace CLI's Docker-volume snapshots. If you maintain Compose yourself, use a backup process that covers the same stores. External databases and buckets need separate, coordinated backups.

## Prepare an empty recovery host

Recover the original workspace and confirm that your Docker connection targets the recovery host. Keep the stack stopped. Replace `your-project-id` below with the original ID from `tale.json`; for a development snapshot, use `TALE_RESTORE_PREFIX="${TALE_RESTORE_PROJECT}-dev_"` instead. Production and development namespaces are different, and the CLI selects production first when both exist.

```bash
TALE_RESTORE_PROJECT=your-project-id
TALE_RESTORE_PREFIX="${TALE_RESTORE_PROJECT}_"
docker volume create --label "project=$TALE_RESTORE_PROJECT" "${TALE_RESTORE_PREFIX}config-data"
docker volume create --label "project=$TALE_RESTORE_PROJECT" "${TALE_RESTORE_PREFIX}backups"
docker volume inspect "${TALE_RESTORE_PREFIX}backups"
```

This prepares the configuration and backup volumes without starting a backend or applying migrations. Restore the complete saved contents of `backups` into that volume using your backup system; the inspected mountpoint belongs to the Docker host, which may be remote. Snapshot directories and their manifests must retain their original layout. `tale restore` must then list the expected snapshot. During an actual restore, the CLI creates any other missing target volumes after verifying the snapshot.

## Check the snapshot's scope

`tale backup` captures existing project volumes from this inventory:

| Volume | Included data |
| --- | --- |
| `db-data` | Application data and, in the packaged single-host stack, the knowledge database. |
| `knowledge-db-data` | The separate knowledge database when this volume exists, as in source Compose. |
| `config-data` | Organization configuration, supported secret sidecars, and branding. Provider credentials stored in Postgres belong to the database backup. |
| `object-store-data` | Uploaded files and generated media when the deployment default uses the bundled store. |
| `caddy-data`, `caddy-config` | Certificates and proxy state. |

A snapshot contains an archive and SHA-256 sidecar for each captured volume. `manifest.json` is written last and records the platform version when it can be determined. A directory without a manifest is incomplete: it is excluded from restore listings and can be removed by rotation after a newer complete snapshot exists.

Also preserve the workspace containing `tale.json`, its `.env`, and any separately mounted key files. In particular, retain `ENCRYPTION_SECRET_HEX` and the age identity needed to decrypt SOPS sidecars. The gateway's `llm-gateway-data` and sandbox workspaces are outside this snapshot inventory; include them in your own plan if you need to retain their state.

<Warning>

External Postgres data is not captured, even when an unused local database volume still appears in the snapshot. The CLI does not warn about this database configuration. External buckets are also outside the snapshot; the CLI reports a repointed default bucket or organization-specific buckets it discovers. Check each organization's storage connections before declaring backup coverage complete.

</Warning>

## Create and verify a snapshot

Run these commands in the intended deployment workspace:

```bash
tale status
tale backup
tale restore
```

`backup` prints the snapshot result. `restore` without an ID only lists available snapshots, including the recorded version and whether blobs are absent. Record the snapshot ID with your external backup IDs.

The snapshot process pauses containers using each volume while that volume is archived. Uploads, downloads, and database work can stall during the relevant pause; duration depends on data size and host throughput. These are volume-level crash-consistent archives, not an atomic transaction across all stores. For a coordinated recovery point, stop incoming writes and scheduled work or use a maintenance window that also covers external stores.

A version-changing `tale deploy`, or a host-config override, takes a snapshot before its mutating steps. Snapshot failure aborts that deployment. `--skip-backup` bypasses this protection; use it only when your recovery plan already provides the required backup.

## Retain a copy off the host

Snapshots live in the project's `backups` Docker volume. A host or disk failure can destroy both live data and local snapshots. Copy completed snapshots, workspace configuration, and keys into your existing protected off-host backup system; Tale does not upload them for you.

Use the project ID from `tale.json` to locate the volume:

```bash
docker volume inspect <project-id>_backups
```

The mount location belongs to the Docker host, which may be a VM or remote machine. Point your backup agent there rather than assuming the path exists on your workstation. Verify that the off-host copy includes `manifest.json`, every archive it names, and each checksum sidecar.

Local rotation keeps the newest five snapshots **and** snapshots from the last 14 days. It deletes a snapshot only when it is outside both windows. Set `BACKUP_KEEP_COUNT` and `BACKUP_KEEP_DAYS` in `.env` to change these windows; configure off-host retention separately.

## Restore the matching data and version

<Warning>

Restoring replaces the contents of the included data volumes. Preserve the current state if you may need it, verify the destination workspace, and keep users and scheduled integrations away from the recovery environment until it is accepted.

</Warning>

1. Retrieve the completed snapshot, deployment workspace, matching keys, and any external-store backups. On a fresh host, follow the empty-host preparation above before proceeding.
2. Run `tale restore` to select an ID and read its platform version. If that version is unknown, resolve it from your deployment records before starting the application.
3. Restore with the stack stopped. `--stop` stops running project containers; the CLI then verifies archive checksums and asks for confirmation before replacing data.

```bash
tale restore <snapshot-id> --stop
```

4. Restore external databases and buckets to the coordinated recovery point while traffic remains stopped. A snapshot marked `without blobs` leaves the existing local blob volume untouched.
5. Select the version recorded for the snapshot and deploy it, including the stateful services:

```bash
tale update --version <snapshot-platform-version>
tale deploy --stop
tale status
```

The version matters because a newer backend can apply migrations as soon as it starts. A data restore followed by an arbitrary current image is not a rollback to the recorded state. Older `convex-data` config archives are restored into the current `config-data` volume by the CLI.

## Prove recovery before reopening traffic

In an isolated drill, sign in, open a known conversation, download an old file, check organization configuration, and run a controlled knowledge query. Verify access to provider secrets and external storage without triggering production notifications or automations. Record lost-data range, elapsed recovery time, and every manual step.

Repeat the drill after material storage, key, or deployment changes and at the interval your recovery objectives require. Use [Upgrades](/self-hosted/operate/upgrades) for version selection and [Troubleshooting](/self-hosted/operate/observability/troubleshooting) if a restored service does not become healthy.
