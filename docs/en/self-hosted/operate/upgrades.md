---
title: Upgrade and recover a deployment
description: Preview a workspace upgrade, deploy with a recovery plan, verify the result, and choose the correct rollback path.
---

For a workspace deployment, `tale update` changes the CLI and workspace files; `tale deploy` changes the running services. Choose the target version and recovery point before either step. A blue-green rollout overlaps application replicas, but snapshots, drain periods, and stateful-service replacements can interrupt work.

Managed deployments use pinned source revisions and prepared bundles instead of this workspace procedure. Follow [Managed deployments](/self-hosted/install/cli-install#managed-deployments) for that workflow, or [Configuration releases](/self-hosted/configuration/config-releases) when only client content changes.

## Prepare the upgrade

1. Run `tale status` in the intended workspace. Record the running version, workspace version, and current deployment state.
2. Read the target release notes for compatibility, required configuration, and known limitations. A pre-0.5 instance needs the separate cutover below, and a workspace on v0.5.77 or earlier crosses the automation writer protocol cutover once, also described below.
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
| `platform`, with `backend-api` and `backend-worker` where they run apart | Roll together as the new application colour. | Old and new replicas overlap, and draining can refuse new turns. |
| `sandbox`, `sandbox-egress` | Replace in place after draining relevant work. | These are shared execution dependencies, not a second blue-green application group. |
| `db`, `object-store`, `proxy` | Keep the running services; the CLI reports skipped updates. | Add `--stop` when these services need replacement. |

```bash
tale deploy --stop
```

On a deployment installed before this release, that deploy also moves the files from MinIO to versitygw, as [Files move from MinIO to versitygw](#blob-store) describes.

`TALE_PLATFORM_REPLICAS` sets how many `platform` replicas a colour runs, from 1 to 16; each one is the whole application. Setting `TALE_BACKEND_WORKER_REPLICAS` or `TALE_BACKEND_API_REPLICAS` [runs the workers apart](#one-process), so they scale on their own. Increase what measurements show is constrained; adding workers does not solve an unavailable database or provider quota.

## Understand the handover

The CLI starts the idle colour and waits for its replicas to pass health checks before completing the handover. Both versions can serve during the overlap, so releases must remain compatible with the previous application version while migrations run.

The old API is drained before removal: new chat turns can receive a drain refusal while existing turns get time to finish. The chat drain waits up to three minutes; the web drain uses `DRAIN_TIMEOUT`, which defaults to 30 seconds. The web health route stays healthy while its alias is still shared. Disconnecting the old containers from serving networks removes them from DNS and can sever remaining connections, so it follows the drains.

The drain covers automations too. Workers of the old colour start no new job and hand each automation run on at its next step, so the run continues on the new colour; the CLI waits for those steps within the same three minutes. When the old containers stop, each worker gets 120 seconds to hand on what it still holds (more when you raise `SHUTDOWN_DRAIN_MS`: the CLI keeps this grace 15 seconds above it), and a step still working 20 seconds into its stop is interrupted and runs again on the new colour. A step that was sending something to an outside service is the exception, because the service may already have received it: that run waits for a person to choose how it continues, as [Read automation runs and recover from failures](/platform/automations/execution-logs) describes. The first upgrade to automation writer protocol 2 is different: the migration holds all older queued, running and waiting runs, preserving their previous state and unknown external outcomes. They do not resume automatically. Work already admitted or sent by an old worker may still finish; an explicit stop request records the operator and requests cancellation of the owned session, but proves neither termination nor the outcome of an external write. It does not release the held task or its evidence. Review the actual outcome before planning any replacement work.

Both colours mount the deployment's `static-assets` volume. Before a web replica becomes ready, it publishes the build's immutable scripts, styles, fonts and images there. Either colour can then serve assets referenced by the other colour's HTML. Running replicas refresh their artifacts hourly; retired artifacts remain available for seven days after their last refresh. Mount this shared volume on every web replica in your own Compose setup too. During the first upgrade from a release without this support, the old replicas still lack the shared fallback.

An open tab normally keeps working across the handover. If a required part is no longer available, Tale waits until its API and database answer, then reloads once. If the part still cannot load, it shows **A new version is available** with a **Reload** action instead of repeating the reload. During an outage, the connection notice stays visible. Failed reads refresh when connectivity returns; failed writes are not submitted again automatically.

If the new group does not become healthy within `HEALTH_CHECK_TIMEOUT`, the deploy does not complete the flip. Inspect the recorded deployment state and logs before retrying. An interrupted rollout can leave both groups or pending handover state; use the CLI's recovery output rather than deleting containers or state files by hand.

## Upgrade a workspace on Incus {#incus}

A workspace on the experimental [Incus runtime](/self-hosted/install/incus) upgrades with the same `tale update` and `tale deploy`. What differs is how the CLI changes the stack and hands traffic from one colour to the other. A managed deployment on Incus has no colours and replaces each service in place, and its upgrade is refused for now; see [the current limits](/self-hosted/install/incus#limits).

### Review the plan first {#incus-plan}

```bash
tale --json deploy --plan-only > plan.json
tale deploy --plan plan.json
```

`--plan-only` prints one plan per scope, for the volumes, the infrastructure, the stateful services and the colour it brings up, and changes nothing. `--plan` applies the reviewed plan only while the node still needs exactly it, and checks every scope before it changes anything. Before any change, `tale deploy` checks the node against the stack's contract; after you raise a replica count, run `tale incus bootstrap` again so that the project's limits fit. The snapshot before a version change is a native set, taken under a freeze of well under a second, as [Snapshots on Incus](/self-hosted/operate/backups-and-restore#incus) describes.

### Replace the stop-gated services {#incus-stop-gated}

On Incus the stop-gated tier is larger: besides `db`, `object-store` and `proxy`, the resolvers (`names`, `names-sessions`) and the traffic switch keep the image they run until a deploy with `--stop`, and the CLI reports what it left. Replacing the switch or the proxy interrupts all traffic until the new instance is healthy, so plan a short window for `tale deploy --stop`.

### Follow the colour flip {#incus-flip}

The traffic switch is an instance of the proxy image that stands in front of the `platform` and `backend-api` replicas, and of the model relay that the `backend-api` replicas serve on port 8080. It lists every replica address of both colours from the start and is never reloaded during a flip, a rolling replacement or a rollback. Each replica of the new colour takes traffic once it passes the switch's admission probe, which a replica answers only once it is ready, and the CLI waits until every replica is healthy.

The CLI then withdraws the old colour: it marks each old replica so that its admission probe fails, and within seconds the switch sends it no new request. The replica's `/api/health` keeps its meaning and fails only after its stop signal, so the edge's own health check is not disturbed. Open streams, such as a page's live updates, stay open on the old colour. Then the drains run as described above, each old replica stops within its grace period and is deleted, and its streams end there: the clients reconnect to the new colour. On Docker the order differs, because the old containers leave the serving networks only after the drains.

If a deploy stops partway through the flip, the next `tale deploy` continues from the recorded phase, and `tale status` reports the unfinished flip until then; do not delete instances by hand. `--services` replaces the live colour's replicas one at a time instead: each is withdrawn, drained, replaced, and healthy before the next one goes. `tale rollback` takes the same steps towards the previous version.

### Stop and start the environment {#incus-stop-start}

```bash
tale stop
tale start
```

`tale stop` stops the environment in three groups: the edge, the switch and both colours; then the sandbox services; then the databases, the object store and the resolvers. Each service gets its own grace period. `tale start` starts the groups the other way round, each healthy before the next, also starts a service Incus stopped after repeated crashes, and refuses while a restore is pending. `--dry-run` prints the order and changes nothing. On a host that runs other projects beside Tale, run `tale stop` before the host shuts down: Incus then stops every project's groups one after another, for up to 30 seconds each, and the databases can be cut off before their stop signal, as [Plan for host shutdown](/self-hosted/install/incus#host-shutdown) explains.

## Check migrations and the user outcome

At boot, the backend applies its numbered migrations in file-name order under a session advisory lock. SQL migrations change the schema; TypeScript data migrations update existing rows by the application's own rules. The `app_migrations` table records both kinds by file name, so each runs once per database. Other replicas wait for that migration path. A migration error prevents the new backend from starting normally; inspect its error and the database before retrying. Forward-only migrations are not undone by changing an image tag.

`tale migrate` adds the shipped configuration files an organization is missing, and the starter project to an organization that has no project. It adds no automation, and it is not a command for rolling database migrations backward. Review whether local configuration was meant to be replaced before using host-config override options.

After deployment, verify the public certificate and sign-in, open an existing project or conversation, download a known file, and run a controlled check of the knowledge and automation paths you use. Check worker progress, store health, and the final deployed version. Keep the pre-upgrade recovery set until the deployment has met your acceptance criteria.

## Choose a rollback path

| Situation | Recovery path |
| --- | --- |
| Return to the recorded previous version in the same `major.minor` line | `tale rollback` checks that boundary and asks for confirmation before redeploying. Review that release's compatibility notes as well. |
| Return across a minor or major boundary | Restore the coordinated pre-upgrade data and deploy its matching version. `tale rollback` refuses this image-only downgrade. A workspace that runs the application as one process [brings its three services back first](#one-process). |
| Target version or data compatibility is unknown | Resolve the version and backup provenance before starting an older binary. |

```bash
tale rollback
```

`--yes` skips its confirmation for an already approved unattended operation. The CLI's same-line check is a version guard, not an independent proof that every external integration or locally customized configuration is compatible. Never assume that downgrading is safe merely because an old migration list is a prefix of the new one.

`tale rollback` swaps the application's images only: those of `platform`, and of `backend-api` and `backend-worker` where they run apart. It restores no volume, leaves the database, the stores, the proxy and the sandbox services as they are, and never starts the model gateway again, as [The model relay replaces the model gateway](#model-relay) explains. No deployment step restores data on its own either: a default deploy (without `--services`) that fails its health checks keeps the previous application colour serving, but the services it already replaced in place stay replaced. Only `tale restore` puts a snapshot's volumes back.

## The model relay replaces the model gateway {#model-relay}

Until this release, a service of its own, `sandbox-llm-gateway`, stood between a coding agent in a sandbox and the model provider, and served the [model endpoints for API keys](/platform/admin/governance/content-models#model-endpoints). The backend now does that job in its [model relay](/self-hosted/configuration/environment-reference#model-relay). Every model call of an agent's turn and every call of the model endpoints goes through the relay, which calls each provider with the organization's credential at the endpoint the provider's definition names. The relay runs in the process that serves the API, so a deployment runs one container fewer, and the gateway's memory limit, from 512 MiB to several GiB, is gone.

With **Process prompts only in the EU/EEA** on, the model of a coding agent or of a model endpoint is now judged at the endpoint the relay calls, as in chat. A catalog provider such as OpenRouter pointed at `eu.openrouter.ai` now passes, where the gateway refused it; [Process prompts only in the EU/EEA](/platform/admin/governance/content-models#eu-processing) lists what counts.

A new deployment runs no gateway, and `tale init` and `tale deploy` no longer generate `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD`. A deployment that runs a gateway keeps it while keys the gateway minted are still open: the keys of agent turns that started before the upgrade and have not settled yet. The backend reads the spend of those turns from the gateway and revokes their keys with the admin password, so leave the password in `.env` as it is while the gateway is kept. On Docker, where `.env` has lost it, `tale deploy` puts it back from the gateway's own environment before it starts the new colour, and says so. Where the gateway holds none either, the deploy says what is missing: set the password in `.env` to the one the gateway was deployed with and deploy again, or, if it is lost, remove the `<id>-sandbox-llm-gateway` container yourself. The next deploy then tells the backend that the gateway is retired, and the keys it minted close without their spend. On Docker, each `tale deploy` also asks the running backend how many such keys are open. `<id>` is the `id` in `tale.json`:

- **None:** the deploy removes the `<id>-sandbox-llm-gateway` container, never its volume, and prints how to remove the volume.
- **Some:** the deploy leaves the container as it is and says how many keys the gateway minted are still open: those of turns that started before the upgrade, of sessions that still run, and of an organization being deleted. A later `tale deploy` asks again.
- **No answer:** the deploy keeps the container and says why. On the first deploy of this release, the backend it asks is still the earlier release's, which cannot answer. The next `tale deploy` asks again.

Once the container is gone, `tale deploy` and `tale rollback` start the backend with `SANDBOX_LLM_GATEWAY_URL` empty, which tells it that the gateway is retired: it asks nothing of the gateway any more, even on a host that cannot reach a DNS server.

`tale deploy --dry-run` asks the same question and says which of these the deploy would do.

The volume `<id>_llm-gateway-data` stays when the container goes. It holds the keys of the providers the gateway reached, in the gateway's SQLite database, and the spend of the keys it minted. Remove it once no turn needs it, with the command the deploy printed:

```bash
docker volume rm <id>_llm-gateway-data
```

The other commands treat the gateway and its volume as follows:

- Snapshots from this release on no longer archive the volume. Restoring an older snapshot that holds it still restores it.
- `tale reset --all` removes a kept gateway's container and its volume with the other data volumes, never the `backups` volume.
- `tale restore` stops a kept gateway that is running, like the other stateful containers.
- `tale runtime migrate --finish` removes the volume with the other Docker data volumes: the Incus stack has no use for it.
- `tale rollback` never starts the gateway again. A release from before the relay runs agent turns and the model endpoints through the gateway, so after a rollback to such a release, they work only while the gateway's container still runs. `tale deploy` removes the container only while a release with the relay runs, and `tale rollback` returns to the release that ran before the last deploy, so a rollback after the removal returns to a release with the relay.

On your own Compose files or on Kubernetes, nothing asks the backend for you. Sessions reach the relay on the backend API's port 8080: on Kubernetes, the `backend-api` Service must expose it and session Pods must be allowed to reach it, as [Deploy on Kubernetes](/self-hosted/install/kubernetes) shows, and `kubectl apply` leaves the gateway's Deployment, Services and claim in place. Remove the gateway's service once no key it minted is open, and its volume or claim once no turn needs it. Then set `SANDBOX_LLM_GATEWAY_URL` empty for the backend: on a host whose containers cannot reach a DNS server, the backend would otherwise take the removed gateway for one that is away for a while, and the deletion of an organization would wait for it. With [`TALE_CONTROL_TOKEN`](/self-hosted/configuration/environment-reference) set on the backend, ask it as `tale deploy` does; it answers `{"open":0}` once none is:

```bash
docker compose exec backend-api sh -c 'curl -fsS -H "Authorization: Bearer $TALE_CONTROL_TOKEN" http://localhost:3005/api/control/gateway-keys'
kubectl -n tale exec deploy/backend-api -- sh -c 'curl -fsS -H "Authorization: Bearer $TALE_CONTROL_TOKEN" http://localhost:3005/api/control/gateway-keys'
```

## The application as one process {#one-process}

A workspace runs the application as one `platform` process per replica: the web tier, the API and the workers. Earlier releases ran them as three services, `platform`, `backend-api` and `backend-worker`, and their images still do.

The first `tale deploy` of a release that can run as one process starts the new colour that way beside the old colour of three services, and retires the old one after the handover, like any other deploy. `tale deploy --dry-run` names the services the new colour would run. Afterwards:

- No `backend-api` or `backend-worker` container exists. `tale logs backend-api` and `tale logs backend-worker` read the `platform` log instead. Update what you maintain yourself that names those containers, such as a log shipper or an alert.
- Other services still reach the API under the name `backend-api`, which `platform` now answers as well.
- `PLATFORM_MEMORY_RESERVATION` sizes the one process and defaults to `256m` for it, up to its `12g` memory limit. `BACKEND_API_MEMORY_RESERVATION` and `BACKEND_WORKER_MEMORY_RESERVATION` apply to those services only where they exist.
- `tale deploy --services platform` replaces the whole application in place, so it drains chat turns first. Naming a service the live colour does not run is refused with the list of those it runs.

To scale the workers on their own, set `TALE_BACKEND_WORKER_REPLICAS`, `TALE_BACKEND_API_REPLICAS` or both, to any value from 1 to 16, and deploy. The new colour then runs `backend-worker` with its count beside a `platform` that is the web tier and the API, with the larger of `TALE_PLATFORM_REPLICAS` and `TALE_BACKEND_API_REPLICAS` replicas. Remove both variables and the next deploy returns to one process.

`TALE_APP_TIER` names the shape outright and wins over the replica counts: `one-process`, `workers-apart` or `three-services`. With `three-services`, a release that can run as one process still runs `platform` as the web tier alone, beside `backend-api` and `backend-worker`.

A CLI from before this change deploys only over three services. It looks for the `backend-api` and `backend-worker` containers, and without them it refuses to deploy or roll back, changing nothing: with `The installed backend database connection is unknown` over one process, and with `The installed backend database inventory is incomplete` where only the workers run apart. Before you return to such a CLI, for instance to restore a snapshot from an earlier release line, set `TALE_APP_TIER=three-services` and run `tale deploy` with the current CLI, so the workspace runs the services the older one knows. Do it before the restore: afterwards the data belongs to the earlier release, and only that release's CLI may start it. `tale restore` checks this itself where the earlier release's image is still on the host, and refuses before it changes anything. Remove the variable once you are back on a release that runs as one process. `tale rollback` needs no such step: the current CLI starts the earlier release's three services itself.

Each colour runs the services its own image supports, so `tale rollback` to a release from before this change brings its three services back. The Compose file in the repository, the [Kubernetes manifests](/self-hosted/install/kubernetes) and the [Incus runtime](/self-hosted/install/incus) keep the three services.

## A database sized for a small host {#database-profile}

`tale deploy` starts the bundled database with the `small` profile: 32 MB of shared buffers where it had 256 MB, 4 MB for a sort where it had 32 MB, 40 connections where it had 100, one autovacuum worker and no parallel query. With it the database holds less than half the memory it held under the same load, which a deployment on a host of half a gigabyte needs. The application opens fewer connections to match, [15 at most from its one process](/self-hosted/configuration/environment-reference#database).

A running database keeps its sizes through `tale deploy`, which leaves it running. It takes these when it is recreated, by `tale deploy --services db` or `tale deploy --stop`, which interrupt the application briefly. Nothing on disk changes, and search works as before: past its shared buffers PostgreSQL reads through the host's page cache.

A host with memory to spare and a large knowledge base is better served by the earlier sizes. Before you deploy, set this in the workspace's `.env`:

```dotenv
DB_PROFILE=standard
```

To change one size alone, name it instead, such as `DB_SHARED_BUFFERS=1GB`. A size you name wins over the profile.

## The token provider for YouTube links is off by default {#token-provider}

Earlier releases started `bgutil-provider` with every deployment. `tale deploy` now starts it only where the workspace's `.env` sets `VIDEO_INGEST_POT_PROVIDER=true`, and the first deploy of this release removes the one that is running otherwise.

YouTube links keep working from an address that YouTube does not challenge. From one it does, a link fails and names the provider. If your members paste YouTube links and your host is in a data center, [turn the provider on](/self-hosted/configuration/video-ingestion#token-provider) before you upgrade.

## Files are read within a memory limit {#file-memory-limit}

A replica now reads each file in a process of its own, one file at a time, and stops reading a file that needs more memory than the limit. Until this release a large spreadsheet or PDF was read inside the application process, which could grow by hundreds of megabytes while it did.

The limit is 512 MiB, and 96 MiB where `tale deploy` runs the application as one process, which a deployment on a host of half a gigabyte needs. Under 96 MiB a spreadsheet of 100,000 rows by 10 columns still fits, and so does about 20 MB of plain text. A file that needs more shows **Failed** with an explanation that names the limit. If your documents are larger and the host has memory to spare, set this in the workspace's `.env` before you deploy:

```dotenv
HEAVY_SLOT_MEMORY_MB=512
```

Afterwards, use **Retry indexing** on a document that failed. [Memory for reading files](/self-hosted/configuration/environment-reference#file-memory) lists what fits and how to read more than one file at once.

## Video links are fetched in a sandbox session {#video-sandbox}

Until this release, the backend ran `yt-dlp` beside itself to read a video link. It now runs it in a sandbox session of the link's own, so that whatever a member pastes is fetched under the sandbox's rules and admitted by the sandbox host, not inside the application.

Check four things before you upgrade:

- **Sandbox destinations.** A link's requests now leave through the sandbox's egress proxy. If `SANDBOX_EGRESS_ALLOWLIST` is set, add the video platforms your members use and the hosts those platforms serve media from. The backend itself no longer connects to a video platform, only to a proxy you configured for video.
- **Render sessions.** Each link in progress holds one of the organization's **Render sessions**, which website crawling uses too. The default is 2. A link that finds none free waits; if links stay **Queued** while sites are crawled, raise the limit under **Settings > Sandboxes**.
- **Development settings.** `VIDEO_INGEST_BIN_DIR`, `VIDEO_INGEST_FFMPEG_LOCATION` and `VIDEO_INGEST_YTDLP_PLUGIN_DIRS` name tools on the backend's own machine. A deployment's session uses the tools of its image and ignores them.
- **Images you build or pin yourself.** The application image no longer carries `yt-dlp`; the sandbox runtime image does. Run the sandbox runtime image of this release: with an older one, every link fails with "Video processing is not enabled yet — contact your administrator".

The audio of a video without captions is now stored as the platform serves it, typically as a WebM or M4A file, where it used to be converted to MP3. Transcripts are unchanged. [Configure video transcript ingestion](/self-hosted/configuration/video-ingestion#where-retrieval-runs) describes where a link is fetched and its limits.

## Files move from MinIO to versitygw {#blob-store}

A new deployment keeps its files in versitygw, an S3 server that stores each object as a file of its own in the `blob-data` volume. It needs a fraction of MinIO's memory and has an image for ARM64. A deployment installed earlier keeps its files in `object-store-data`, in a format of MinIO's own that versitygw cannot read. `tale deploy` therefore keeps MinIO there and says so:

```text
The blob store stays MinIO: this deployment's blobs are in <id>_object-store-data, in MinIO's format. A new install runs versitygw. `tale deploy --stop` moves the blobs to versitygw, pausing the application for the last copy.
```

A deploy that replaces the store moves the files: `tale deploy --stop`, `tale deploy --services object-store`, or any deploy that finds the store stopped. With `--dry-run`, it names the move and makes none. Before it copies anything, the CLI checks three things, and keeps MinIO if one fails:

- `OBJECT_STORE_SECRET_KEY` is set in the workspace's `.env`.
- The filesystem that holds `blob-data`, usually the one under `/var/lib/docker`, has room for MinIO's volume, a tenth more and 1 GiB. Both volumes stay on it until you remove MinIO's.
- An object that versitygw writes there comes back with its content type and ETag. versitygw keeps both in extended attributes, which ext4, XFS and Btrfs support. On a filesystem without them, every file would come back without its type.

The CLI then copies every bucket while the application keeps working. Next it pauses the application for a last copy of what was written since the first copy began, which also removes what was deleted meanwhile. It compares the buckets, objects and bytes on both sides, starts versitygw as the store, and resumes the application. Requests wait during the pause, so plan a short maintenance window. The pause grows with what changes during the first copy and with the number of files, which the comparison lists on both sides.

When the move succeeds, the deploy reports what it moved and leaves MinIO's volume as it was:

```text
Moved <n> object(s), <size>, to versitygw on <id>_blob-data. <id>_object-store-data is left as it was: remove it once you no longer need it (docker volume rm <id>_object-store-data).
```

When a check or a step fails, MinIO serves the files as before. The CLI removes what the move wrote to `blob-data`, names the reason, and continues the deploy with MinIO:

```text
The blobs stay in MinIO (<id>_object-store-data), which serves them as before: <reason>.
```

Fix the reason and run `tale deploy --stop` again. After a successful move:

1. Download a few known files and open them.
2. Take a snapshot with `tale backup`. It archives `blob-data` with its extended attributes.
3. Remove MinIO's volume once you no longer need it: `docker volume rm <id>_object-store-data`.

`tale rollback` keeps versitygw. Do not move the workspace back to an earlier release with `tale update --version`: its CLI knows only MinIO and would start it on MinIO's volume as it was before the move, without the files uploaded since, or on an empty volume once you removed it. To return to such a release, restore a snapshot taken before the move, as [Backups and restore](/self-hosted/operate/backups-and-restore) describes.

`tale deploy` moves the files on Docker. For a stack on your own Compose files or on Kubernetes, follow [Move the blobs from MinIO to versitygw](/self-hosted/install/own-compose#blob-store).

## Pi is the default agent runtime {#pi-default}

Agent turns that name no agent runtime now run on Pi: an automation's agent step left on **Default (Pi)**, and the organization's [standard agent](/platform/admin/governance/content-models#standard-agent) while its **Agent runtime** is **Automatic**. Earlier releases ran them on Claude Code. Nothing stored changes, so an existing organization moves at its next run, and agents and steps that name a runtime keep it.

A model that only a subscription serves keeps running on the agent runtime that subscription is bound to, such as Claude Code for a Claude subscription, instead of being refused. A step that was running when you upgraded finishes its turn where it began; if it is retried, the retry starts a new conversation on Pi over the same workspace. While both colours run during the handover, a worker of the earlier release can still take the retry of a step this release began on Pi. It hands Pi's conversation to Claude Code, which cannot continue it, so that retry is lost. Each run's agent log says which runtime ran a turn and why.

To keep Claude Code, name it where the run takes its runtime:

- For an automation's agent step, choose **Claude Code** in its **Agent runtime** field, or set `harness: claude-code` on the node.
- For the standard agent, choose **Claude Code** as its **Agent runtime** under **Settings > Governance > Models**, or set `harness: claude-code` in its [policy file](/self-hosted/configuration/providers#configure-the-standard-agent).

Project agents you created name their runtime already and do not change.

## Upgrade from v0.5.77 or earlier

Releases from v0.5.78 on write automation runs with writer protocol 2. Their migration `0163` puts every run that is still queued, running or waiting **On hold**, and a held run never resumes. The first upgrade from v0.5.77 therefore stops the old backend while no run is unfinished, and only then starts the new version. `tale deploy` does this itself, once.

1. If the workspace runs a release older than v0.5.77, bring it to v0.5.77 first. The cutover starts only from that release:

   ```bash
   tale update -v 0.5.77
   tale deploy
   ```

   These steps use `-v`: CLIs from before the release that fixed it read `tale update --version` as a request for their own version and change nothing.

2. Let every automation run in every organization finish, or cancel it, and pause schedules and triggers that would start new ones until the upgrade is done.
3. Confirm your off-host backup, then update and preview. The preview names anything that still blocks the cutover:

   ```bash
   tale update -v <target-version>
   tale deploy --dry-run
   ```

4. Deploy, without `--stop` or `--services`. If db, object-store or proxy need an update, run `tale deploy --stop` afterwards:

   ```bash
   tale deploy
   ```

Before it changes anything, `tale deploy` checks the running backend's release, the database's migration history and the automation runs. If one of them is not ready, it stops with the step to take next and leaves the workspace running as it was. Otherwise it takes its snapshot and replaces the sandbox services as usual. Right before the new colour starts, it holds a lock against new automation runs, confirms that none is unfinished, gracefully stops the old `backend-api` and `backend-worker` containers, and records them in `.tale/automation-cutover.json`. The API is unavailable from that stop until the new colour is healthy.

The new colour's first start applies every database migration since v0.5.77 before it reports healthy, and with a large knowledge base the vector copy can take longer than `HEALTH_CHECK_TIMEOUT`. If the deploy stops at any point after the old backend stopped, run `tale deploy` again with the same release: it recognizes its own handoff, including a first start that was cut off partway through its migrations, waits for the colour that is already starting instead of recreating it, and finishes the upgrade. Keep `.tale/automation-cutover.json`, and do not start the old containers by hand. From the moment the cutover begins, `tale rollback` refuses to return to v0.5.77; recover forward as the next section describes.

Without `tale deploy`, on your own Compose files or the [Kubernetes manifests](/self-hosted/install/kubernetes), nothing holds this barrier for you, and a rolling update starts the new backend containers while the old ones still run. Hold it by hand, in this order: pause schedules and triggers and let the runs finish; stop every v0.5.77 `backend-api` and `backend-worker` and make sure none is left running; check that the query below answers `0`; and only then roll out the new version. If it answers more, start the old backend again, let those runs finish, and stop it again. With Compose, `docker compose stop backend-api backend-worker` stops both and returns once they have exited.

```bash
kubectl -n tale scale --replicas=0 deployment/backend-api deployment/backend-worker
kubectl -n tale get pods -l 'app in (backend-api, backend-worker)'
psql "$DATABASE_URL" -Atc "select count(*) from app.automation_runs where status is null or status not in ('success', 'failed', 'cancelled')"
```

## Automation protocol cutover: repair forward

After the database records automation writer protocol 2, use a runtime that implements protocol 2 and the matching CLI. Before changing deployment files, infrastructure or traffic, the CLI reads the installed migration ledger and verifies the selected backend image’s protocol, source revision and immutable digest. An older image, missing or unsupported protocol metadata, an unreadable or ambiguous ledger, or a changed database identity stops deployment and rollback. A pending colour must contain the same admitted image in every backend role before promotion. A stopped database is not started implicitly to obtain this evidence.

An already-created protocol-2 backend also requires a compatible target, even while stopped or before its first migration commits. The CLI rereads the installed floor after image pulls and before deployment mutations; an older CLI or manual Docker command running alongside it is outside this coordination boundary.

The current tag-based guard supports the bundled application database only. An explicit `DATABASE_URL`, a custom `APP_DB_NAME`, or an installed backend that still points elsewhere is refused until a separately verified readback path exists. Removing an override from `.env` does not prove that the running backend has changed its connection. Keep the existing runtime and repair the readback; do not bypass the refusal with an older CLI.

Older CLIs and manual image replacement do not implement this deployment guard. The database writer fence and separate execution queues remain necessary during mixed-version operation. A backup restores stored data, not messages, payments or other effects already sent to an external service; it does not authorize a pre-protocol runtime after this cutover. Use a compatible forward repair and preserve held runs and their evidence.

## Check the sandbox disk floor before upgrading

The Docker spawner now refuses every new session with HTTP 429 `host_disk` when the disk holding session workspaces is below `SANDBOX_MIN_FREE_DISK`. This also applies to a host already below the floor at upgrade time, even with an explicit `SANDBOX_MAX_SESSIONS`. Existing sessions keep running, but new work waits until space is freed. Stopping idle sessions does not free their preserved workspaces.

Check free space before deploying. The default floor is a twentieth of that disk, at least 2 GiB and at most 20 GiB. Free space safely or deliberately configure another floor; `SANDBOX_MIN_FREE_DISK=0` disables this protection and leaves disk exhaustion to the operator. The spawner can remove unused stopped organizations’ build caches, but pauses relief for six hours after three consecutive removals each gain less than 1 MiB. Do not rely on cache removal to rescue a full host. See the [environment reference](/self-hosted/configuration/environment-reference) for configuration and recovery limits.

## Bifrost 1.6 → 2.2: the model gateway's store is migrated

This concerns the releases that still run the model gateway. From the release that replaces it with the [model relay](#model-relay), `tale deploy` no longer updates the gateway: it keeps or removes it as that section describes.

A release after 0.5.64 moves the model gateway (`sandbox-llm-gateway`) from Bifrost 1.6 to Bifrost 2.2; its release notes list the move. On its first start, the new gateway migrates its store in `llm-gateway-data` in place and keeps its providers, keys, budgets and admin account; nothing needs to be done by hand. The migration also indexes the gateway's request log, so that start can take longer on an instance with a long request history.

`tale deploy` replaces the gateway before it starts the new application colour, so a deployment that fails later can leave the store already migrated. The snapshot that a version-changing `tale deploy` takes first holds `llm-gateway-data` with the other volumes, so it is the gateway's recovery point too. Snapshots taken before the CLI captured the gateway's store have no such archive; `tale restore` lists them as `without gateway`. If you deploy with `--skip-backup`, copy the volume yourself first: stop the gateway, which ends running agent turns and model calls, copy the volume, then deploy. `<id>` is the `id` in `tale.json`:

```bash
docker stop <id>-sandbox-llm-gateway
docker run --rm -v <id>_llm-gateway-data:/from:ro -v "$PWD/llm-gateway-data-backup:/to" alpine:3.22 cp -a /from/. /to/
```

The gateway of a release before the move starts on the migrated store and serves Tale, but it logs `no such column: oauth_configs.token_id` errors, and Bifrost does not support that downgrade. `tale rollback` does not start that gateway: it leaves the gateway on the newer image and store. That gateway starts when a release before the move is deployed again, for example with `tale update --version` and `tale deploy` after a snapshot restore. Return the store first. Restoring the snapshot taken before the upgrade puts `llm-gateway-data` back with the other volumes. If that snapshot is listed `without gateway`, stop the gateway and put your copy back before you deploy the older release:

```bash
docker stop <id>-sandbox-llm-gateway
docker run --rm -v "$PWD/llm-gateway-data-backup:/from:ro" -v <id>_llm-gateway-data:/to alpine:3.22 sh -c 'find /to -mindepth 1 -delete && cp -a /from/. /to/'
```

A gateway without an admin account, on a new installation or after its volume was replaced, now creates the account only for a caller that presents its setup token, which the image takes from `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD`. `tale deploy`, the Compose file in the repository and the Kubernetes manifests in these docs already give the gateway that variable. A hand-written Compose file or manifest that passes it only to the backend must pass it to the gateway as well.

Two behaviours change. A caller that hangs up now ends the model call, whether it asked for a whole answer or a stream, so an abandoned request no longer keeps a self-hosted model busy; the model endpoints book such a call at its prompt and the output that had reached the caller. And an upstream that holds back a streamed answer's response headers, such as a router that queues requests until a model is free, must begin its answer within the gateway's request timeout: 600 seconds, or longer when `SANDBOX_LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS` raises it.

## 0.4 → 0.5: a separate installation

The 0.5 application store replaced the earlier Convex database with Postgres. There is no in-place importer between those stores. Keep the old instance and its backups intact while preparing a fresh deployment in a separate workspace and data set.

Recreate organizations and users, review and transfer compatible configuration, and reimport required documents. Files left in an external bucket do not automatically acquire references in the new application database. Accept the replacement environment before decommissioning the old one.

The CLI refuses the unsupported cutover by default. Its expert `--accept-data-loss` override is not a migration tool and must not be used to preserve old application data. Historical volumes or databases can remain after earlier upgrades; their presence alone is not a reason to delete them during this procedure.

## 0.3 → 0.4: the OpenAI-compatible API was removed

From 0.2.10 through 0.3, Tale served an OpenAI-compatible layer under `/api/v1`: `POST /api/v1/chat/completions` and `POST /api/v1/images/generations` in the OpenAI request and response shapes, and an OpenAI-shaped `GET /api/v1/models`. Its `model` field could name an agent. The 0.4 rebuild removed this layer. Callers of these routes, including OpenAI SDKs pointed at the instance, stop working, because 0.4 serves none of the three routes, and later releases keep them removed. A current release answers chat completions and image generations with `404 NOT_FOUND`, or with `400 ORG_SLUG_REQUIRED` when the key holder belongs to several organizations and the request carries no `X-Organization-Slug`, which an OpenAI SDK does not send by default. Its `GET /api/v1/models` is Tale's own listing of models and agent runtimes, which an OpenAI client cannot read.

Find those callers before the upgrade and plan their replacement. A caller that needs a model's answer can move to the governed model endpoints that releases with API contract 3.7.0 or later offer. They differ from the 0.3 layer: the base URL is `/api/v1/openai`, or `/api/v1/anthropic` for Anthropic clients, rather than `/api/v1`; `model` names a model as `<providerSlug>/<modelId>`, never an agent; image generation is not served; and the endpoints are off until an Admin turns on **Model endpoints for API keys** under **Settings > Governance > Models**. From then on, every call passes model access, the input guardrails, and the budgets. The model endpoints reach the models through the same model relay as managed agents. Scripted questions for the workspace assistant move to the asynchronous REST chat API, which answers as the assistant rather than as a bare model. Editor integrations that want Tale's knowledge use the MCP endpoint, and work that should run inside Tale, in a sandbox and with a person's review, goes to a project agent on a task. [Use Tale from your editor or a script](/develop/use-tale-from-your-editor) describes each path.
