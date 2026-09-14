---
title: Upgrade and recover a deployment
description: Preview a workspace upgrade, deploy with a recovery plan, verify the result, and choose the correct rollback path.
---

For a workspace deployment, `tale update` changes the CLI and workspace files; `tale deploy` changes the running services. Choose the target version and recovery point before either step. A blue-green rollout overlaps application replicas, but snapshots, drain periods, and stateful-service replacements can interrupt work.

Managed deployments use pinned source revisions and prepared bundles instead of this workspace procedure. Follow [Managed deployments](/self-hosted/install/cli-install#managed-deployments) for that workflow, or [Configuration releases](/self-hosted/configuration/config-releases) when only client content changes.

## Prepare the upgrade

1. Run `tale status` in the intended workspace. Record the running version, workspace version, and current deployment state.
2. Read the target release notes for compatibility, required configuration, and known limitations. A pre-0.5 instance needs the separate cutover below.
3. Confirm a restorable off-host backup, the matching keys, and coverage of external databases and buckets. [Backups and restore](/self-hosted/operate/backups-and-restore) defines the recovery set.
4. Allow capacity for old and new application replicas at the same time. Agree on a maintenance window when snapshots, sandbox replacement, or stateful updates can interrupt required work.
5. Preview the selected update and deployment. Inspect warnings rather than treating a successful preview as proof that a live migration will succeed.

## Select the version

Workspace instance commands try to align the CLI with the version recorded in `tale.json`. If downloading that version fails, the CLI warns and continues with the current binary. Resolve an unexpected mismatch before making deployment changes.

Without a version argument, `tale update` selects the newest release in the workspace's current `major.minor` line. Moving to another line is explicit:

```bash
tale update --dry-run
tale update --version <target-version> --dry-run
tale update --version <target-version>
```

The update replaces the CLI and synchronizes workspace templates, leaving running containers alone. If file synchronization fails, it attempts to return the binary to the workspace's prior version. Review the resulting files and output before deploying.

## Preview and deploy

```bash
tale deploy --dry-run
tale deploy
tale status
```

A version-changing deployment or host-config override takes a local snapshot before mutation unless `--skip-backup` is supplied. This snapshot is additional protection, not an off-host recovery plan.

| Service group | Ordinary deployment | When to plan extra interruption |
| --- | --- | --- |
| `platform`, `backend-api`, `backend-worker` | Roll together as the new application colour. | Old and new replicas overlap, and draining can refuse new turns. |
| `sandbox`, `sandbox-egress`, `sandbox-llm-gateway` | Replace in place after draining relevant work. | These are shared execution dependencies, not a second blue-green application group. |
| `db`, `object-store`, `proxy` | Keep the running services; the CLI reports skipped updates. | Add `--stop` when these services need replacement. |

```bash
tale deploy --stop
```

The role replica variables `TALE_PLATFORM_REPLICAS`, `TALE_BACKEND_API_REPLICAS`, and `TALE_BACKEND_WORKER_REPLICAS` accept 1–16. Increase the role that measurements show is constrained; adding workers does not solve an unavailable database or provider quota.

## Understand the handover

The CLI starts the idle colour and waits for its replicas to pass health checks before completing the handover. Both versions can serve during the overlap, so releases must remain compatible with the previous application version while migrations run.

The old API is drained before removal: new chat turns can receive a drain refusal while existing turns get time to finish. The chat drain waits up to three minutes; the web drain uses `DRAIN_TIMEOUT`, which defaults to 30 seconds. The web health route stays healthy while its alias is still shared. Disconnecting the old containers from serving networks removes them from DNS and can sever remaining connections, so it follows the drains.

If the new group does not become healthy within `HEALTH_CHECK_TIMEOUT`, the deploy does not complete the flip. Inspect the recorded deployment state and logs before retrying. An interrupted rollout can leave both groups or pending handover state; use the CLI's recovery output rather than deleting containers or state files by hand.

## Check migrations and the user outcome

The backend applies numbered SQL migrations at boot under a session advisory lock. Other replicas wait for that migration path. A migration error prevents the new backend from starting normally; inspect its error and the database before retrying. Forward-only migrations are not undone by changing an image tag.

`tale migrate` refreshes built-in organization defaults; it is not a command for rolling database migrations backward. Review whether local configuration was meant to be replaced before using host-config override options.

After deployment, verify the public certificate and sign-in, open an existing project or conversation, download a known file, and run a controlled check of the knowledge and automation paths you use. Check worker progress, store health, and the final deployed version. Keep the pre-upgrade recovery set until the deployment has met your acceptance criteria.

## Choose a rollback path

| Situation | Recovery path |
| --- | --- |
| Return to the recorded previous version in the same `major.minor` line | `tale rollback` checks that boundary and asks for confirmation before redeploying. Review that release's compatibility notes as well. |
| Return across a minor or major boundary | Restore the coordinated pre-upgrade data and deploy its matching version. `tale rollback` refuses this image-only downgrade. |
| Target version or data compatibility is unknown | Resolve the version and backup provenance before starting an older binary. |

```bash
tale rollback
```

`--yes` skips its confirmation for an already approved unattended operation. The CLI's same-line check is a version guard, not an independent proof that every external integration or locally customized configuration is compatible. Never assume that downgrading is safe merely because an old migration list is a prefix of the new one.

## 0.4 → 0.5: a separate installation

The 0.5 application store replaced the earlier Convex database with Postgres. There is no in-place importer between those stores. Keep the old instance and its backups intact while preparing a fresh deployment in a separate workspace and data set.

Recreate organizations and users, review and transfer compatible configuration, and reimport required documents. Files left in an external bucket do not automatically acquire references in the new application database. Accept the replacement environment before decommissioning the old one.

The CLI refuses the unsupported cutover by default. Its expert `--accept-data-loss` override is not a migration tool and must not be used to preserve old application data. Historical volumes or databases can remain after earlier upgrades; their presence alone is not a reason to delete them during this procedure.
