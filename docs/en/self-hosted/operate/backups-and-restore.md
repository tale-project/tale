---
title: Backups and restore
description: Plan the complete recovery set, create and copy CLI snapshots, then restore data with its matching Tale version.
---

A recoverable Tale instance needs more than a database archive: keep its files, organization configuration, deployment workspace, and decryption keys together with the version that wrote them. Set your recovery-point and recovery-time objectives first, then test whether your backup schedule and restore procedure meet them.

This guide covers the workspace CLI's snapshots of Docker volumes and, from [Snapshots on Incus](#incus) on, of a workspace on the experimental Incus runtime. If you maintain Compose yourself, use a backup process that covers the same stores. External databases and buckets need separate, coordinated backups.

## Prepare an empty recovery host

Recover the original workspace and confirm that your Docker connection targets the recovery host. Keep the stack stopped. Replace `your-project-id` below with the original ID from `tale.json`; for a development snapshot, use `TALE_RESTORE_PREFIX="${TALE_RESTORE_PROJECT}-dev_"` instead. Production and development namespaces are different, and the CLI selects production first when both exist.

```bash
TALE_RESTORE_PROJECT=your-project-id
TALE_RESTORE_PREFIX="${TALE_RESTORE_PROJECT}_"
docker volume create --label "project=$TALE_RESTORE_PROJECT" "${TALE_RESTORE_PREFIX}config-data"
docker volume create --label "project=$TALE_RESTORE_PROJECT" "${TALE_RESTORE_PREFIX}backups"
docker volume inspect "${TALE_RESTORE_PREFIX}backups"
```

This prepares the configuration and backup volumes without starting a backend or applying migrations. To carry a snapshot as one file instead, or onto a workspace on Incus, use [export and import](#export-import). Restore the complete saved contents of `backups` into that volume using your backup system; the inspected mountpoint belongs to the Docker host, which may be remote. Snapshot directories and their manifests must retain their original layout. `tale restore` must then list the expected snapshot. During an actual restore, the CLI creates any other missing target volumes after verifying the snapshot.

## Check the snapshot's scope

`tale backup` captures existing project volumes from this inventory:

| Volume | Included data |
| --- | --- |
| `db-data` | Application data and, in the packaged single-host stack, the knowledge database. |
| `knowledge-db-data` | The separate knowledge database when this volume exists, as in source Compose. |
| `config-data` | Organization configuration, supported secret sidecars, and branding. Provider credentials stored in Postgres belong to the database backup. |
| `object-store-data` | Uploaded files and generated media when the deployment default uses the bundled store. |
| `caddy-data`, `caddy-config` | Certificates and proxy state. |
| `llm-gateway-data` | The model gateway's store: its admin account, provider keys, session keys with their budgets and spend, and its request log. |

A snapshot contains an archive and SHA-256 sidecar for each captured volume. `manifest.json` is written last and records the platform version when it can be determined. A directory without a manifest is incomplete: it is excluded from restore listings and can be removed by rotation after a newer complete snapshot exists. Snapshots taken before the CLI captured the gateway's store have no `llm-gateway-data` archive.

Also preserve the workspace containing `tale.json`, its `.env`, and any separately mounted key files. In particular, retain `ENCRYPTION_SECRET_HEX` and the age identity needed to decrypt SOPS sidecars. Sandbox workspaces are outside this snapshot inventory; include them in your own plan if you need to retain their state.

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

`backup` prints the snapshot result. `restore` without an ID only lists available snapshots, including the recorded version and whether blobs or the gateway's store are absent. Record the snapshot ID with your external backup IDs.

The snapshot process pauses containers using each volume while that volume is archived. Uploads, downloads, database work, and model calls through the gateway can stall during the relevant pause; duration depends on data size and host throughput. Docker reports a paused container as `unhealthy` until its next successful health check, so after each archive the snapshot waits until every container that was healthy before the pause reports `healthy` again; this usually takes one health-check interval. If a container does not recover within the retries its health check allows, the snapshot fails. These are volume-level crash-consistent archives, not an atomic transaction across all stores. For a coordinated recovery point, stop incoming writes and scheduled work or use a maintenance window that also covers external stores.

A version-changing `tale deploy`, or a host-config override, takes a snapshot before its mutating steps. Snapshot failure aborts that deployment. `--skip-backup` bypasses this protection; use it only when your recovery plan already provides the required backup.

## Retain a copy off the host

Snapshots live in the project's `backups` Docker volume. A host or disk failure can destroy both live data and local snapshots. Copy completed snapshots, workspace configuration, and keys into your existing protected off-host backup system; Tale does not upload them for you.

Use the project ID from `tale.json` to locate the volume:

```bash
docker volume inspect <project-id>_backups
```

The mount location belongs to the Docker host, which may be a VM or remote machine. Point your backup agent there rather than assuming the path exists on your workstation. Verify that the off-host copy includes `manifest.json`, every archive it names, and each checksum sidecar. On either runtime, `tale backup export` also writes one snapshot as a single file you can copy off the host, as [Move a snapshot to another host or runtime](#export-import) describes.

Local rotation keeps the newest five snapshots **and** snapshots from the last 14 days. It deletes a snapshot only when it is outside both windows. Set `BACKUP_KEEP_COUNT` and `BACKUP_KEEP_DAYS` in `.env` to change these windows; configure off-host retention separately.

## Restore the matching data and version

<Warning>

Restoring replaces the contents of the included data volumes. Preserve the current state if you may need it, verify the destination workspace, and keep users and scheduled integrations away from the recovery environment until it is accepted.

</Warning>

1. Retrieve the completed snapshot, deployment workspace, matching keys, and any external-store backups. On a fresh host, follow the empty-host preparation above before proceeding.
2. Run `tale restore` to select an ID and read its platform version. If that version is unknown, resolve it from your deployment records before starting the application.
3. Restore with the stack stopped. `--stop` stops project containers that are running, restarting or paused; the CLI then verifies archive checksums and asks for confirmation before replacing data. Run it with your current CLI, before step 5 changes it: a CLI from before gateway capture skips the gateway archive.

```bash
tale restore <snapshot-id> --stop
```

4. Restore external databases and buckets to the coordinated recovery point while traffic remains stopped. A snapshot marked `without blobs` leaves the existing local blob volume untouched. One marked `without gateway` leaves `llm-gateway-data` untouched and cannot return the gateway to its store from before a gateway upgrade; the CLI warns before it asks for confirmation. If the gateway was upgraded after that snapshot, put your own copy of the volume back before the next step, as [Upgrades](/self-hosted/operate/upgrades) describes.
5. Select the version recorded for the snapshot and deploy it, including the stateful services:

```bash
tale update --version <snapshot-platform-version>
tale deploy --stop
tale status
```

The version matters because a newer backend can apply migrations as soon as it starts. A data restore followed by an arbitrary current image is not a rollback to the recorded state. Older `convex-data` config archives are restored into the current `config-data` volume by the CLI.

## Snapshots on Incus {#incus}

In a workspace that runs on Incus, `tale backup`, `tale restore` and the snapshot before a version-changing `tale deploy` use Incus's own volume snapshots. The commands, the listing and the retention settings stay the same; what a snapshot is, how a restore works and what it needs differ.

### What a native set holds {#incus-sets}

A snapshot on Incus is a set: one native snapshot of each of the stack's data volumes, the inventory above among them, all taken while the running services that use those volumes are frozen. The freeze lasts well under a second, not the length of an archive; afterwards the snapshot waits until every service that was healthy is healthy again. A manifest in the `backups` volume names the set. The volumes the CLI writes itself (the resolvers' records, the traffic switch's upstream lists and the sandbox spawner's credentials) are never part of a set, because the CLI writes them again from the declaration.

A native snapshot lives on its volume, in the same storage pool, so it does not survive the loss of the pool or the host. `tale backup --archive` also writes a `tar.gz` archive of each volume into `backups`, with its SHA-256, in the same format as on Docker. `tale restore` marks each listed snapshot as `native` or `native + archive`. Snapshots that Incus takes on its own schedule (`snapshots.schedule` in `runtime.incus.volumes`) are not sets: `tale restore` neither lists nor rotates them, and Incus expires them by `snapshots.expiry`.

Rotation keeps the same windows as on Docker (`BACKUP_KEEP_COUNT`, `BACKUP_KEEP_DAYS`). It deletes an expired set's native snapshots and archives together, and a volume set aside by a restore once no kept snapshot lives on it any more.

### Restore on Incus {#incus-restore}

A restore on Incus never rolls a volume back in place, so the snapshots newer than the one you restore stay available. For each volume, `tale restore <snapshot-id> --stop` stops the services that use it, each within its grace period, and detaches the volume from them. It sets the volume aside under the name `<volume>.pre-restore-<timestamp>`, which carries its snapshot history along, and copies the snapshot (or extracts its archive) into a fresh volume of the original name. Then it attaches the volume again and starts the services. Without `--stop`, the restore refuses while a service uses one of the volumes.

The volume set aside keeps the full previous data, so a restore needs about twice the volume's space. Before it changes anything, the restore checks that the pool's free space, and what is left of each disk quota the project sets (`limits.disk.pool.<pool>`, `limits.disk`), exceed the size of the copies plus 10%, and refuses otherwise.

Every step is journaled as a pending restore. When a restore stops partway, after a crash, a lost connection or a full pool, `tale deploy`, `tale start`, `tale rollback`, `tale runtime migrate` and a new snapshot refuse, and `tale status` names each volume's step. Nothing makes a missing data volume again empty in the meantime. Finish the restore, or undo it so that every volume is back as it was:

```bash
tale restore --resume
tale restore --abort
```

Then deploy the version the snapshot recorded, as step 5 of [Restore the matching data and version](#restore-the-matching-data-and-version) describes.

`tale backup prune` lists the volumes restores set aside, with the snapshots that still live on them, and deletes, after asking, those on which no listed snapshot lives; `--dry-run` only lists them, `--yes` skips the question. A volume set aside that still holds a listed snapshot is never deleted.

## Move a snapshot to another host or runtime {#export-import}

`tale backup export` writes one snapshot as a single file: a `tar` of its manifest and of each volume's `tar.gz` archive, each archive checked against its SHA-256 on the way out. On Incus, the export first writes the archives a native set lacks, from copies of its snapshots; the native snapshots themselves never leave the host. The export never overwrites a file.

```bash
tale backup export <snapshot-id> --to tale-snapshot.tar
```

Without `--to`, the file is `tale-snapshot-<snapshot-id>.tar` in the current directory. On the destination workspace, `tale backup import` reads the file into `backups`, checks each archive by SHA-256 as it arrives and writes the manifest last, so an interrupted import is never listed. It refuses a snapshot ID the workspace already has. On Incus, deploy the workspace once first, so that its `backups` volume exists. Then restore as usual:

```bash
tale backup import tale-snapshot.tar
tale restore <snapshot-id> --stop
```

The format is the same on both runtimes, so a file exported on Docker restores on Incus and the other way round, with the same `.env`, keys and version on both ends. [`tale runtime migrate`](/self-hosted/install/incus#migrate) takes these steps itself when it moves a workspace from Docker to Incus.

## Know what a reset keeps {#reset}

`tale reset --all` deletes the data volumes, and `tale uninstall --purge` tears the whole project down. What survives differs by runtime:

| Runtime | Deleted | Kept |
| --- | --- | --- |
| Docker | The data volumes. | The `<project-id>_backups` volume with every snapshot. |
| Incus | The data volumes, and with them every native snapshot that lives on them. | The `backups` volume, with the newest set's archive and every archive and manifest it already held, and the volumes restores set aside. |

On Incus, the reset first archives the newest set into `backups` and verifies the archive. If that fails, it refuses and deletes nothing; `--discard-snapshots` deletes the volumes anyway and loses their native snapshots. An older set without an archive can no longer be restored once its volumes are gone, unless it lives on a volume a restore set aside, so archive what you want to keep with `tale backup --archive` before you reset. The next `tale deploy` creates empty data volumes, and `tale restore` lists the archived snapshot.

## Prove recovery before reopening traffic

In an isolated drill, sign in, open a known conversation, download an old file, check organization configuration, and run a controlled knowledge query. Verify access to provider secrets and external storage without triggering production notifications or automations. Record lost-data range, elapsed recovery time, and every manual step.

Repeat the drill after material storage, key, or deployment changes and at the interval your recovery objectives require. Use [Upgrades](/self-hosted/operate/upgrades) for version selection and [Troubleshooting](/self-hosted/operate/observability/troubleshooting) if a restored service does not become healthy.
