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

The drain covers automations too. Workers of the old colour start no new job and hand each automation run on at its next step, so the run continues on the new colour; the CLI waits for those steps within the same three minutes. When the old containers stop, each worker gets 120 seconds to hand on what it still holds (more when you raise `SHUTDOWN_DRAIN_MS`: the CLI keeps this grace 15 seconds above it), and a step still working 20 seconds into its stop is interrupted and runs again on the new colour. A step that was sending something to an outside service is the exception, because the service may already have received it: that run waits for a person to choose how it continues, as [Read automation runs and recover from failures](/platform/automations/execution-logs) describes. The first upgrade from a release without this behaviour cannot use it yet: a run the old workers were stepping is taken over by the new colour about four minutes after its old worker stopped, and a write that worker was making can be sent a second time.

Both colours mount the deployment's `static-assets` volume. Before a web replica becomes ready, it publishes the build's immutable scripts, styles, fonts and images there. Either colour can then serve assets referenced by the other colour's HTML. Running replicas refresh their artifacts hourly; retired artifacts remain available for seven days after their last refresh. Mount this shared volume on every web replica in your own Compose setup too. During the first upgrade from a release without this support, the old replicas still lack the shared fallback.

An open tab normally keeps working across the handover. If a required part is no longer available, Tale waits until its API and database answer, then reloads once. If the part still cannot load, it shows **A new version is available** with a **Reload** action instead of repeating the reload. During an outage, the connection notice stays visible. Failed reads refresh when connectivity returns; failed writes are not submitted again automatically.

If the new group does not become healthy within `HEALTH_CHECK_TIMEOUT`, the deploy does not complete the flip. Inspect the recorded deployment state and logs before retrying. An interrupted rollout can leave both groups or pending handover state; use the CLI's recovery output rather than deleting containers or state files by hand.

## Check migrations and the user outcome

At boot, the backend applies its numbered migrations in file-name order under a session advisory lock. SQL migrations change the schema; TypeScript data migrations update existing rows by the application's own rules. The `app_migrations` table records both kinds by file name, so each runs once per database. Other replicas wait for that migration path. A migration error prevents the new backend from starting normally; inspect its error and the database before retrying. Forward-only migrations are not undone by changing an image tag.

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

`tale rollback` swaps the application images of `platform`, `backend-api`, and `backend-worker` only. It restores no volume and leaves the database, the stores, the proxy, the sandbox services, and the model gateway as they are. No deployment step restores data on its own either: a default deploy (without `--services`) that fails its health checks keeps the previous application colour serving, but the services it already replaced in place stay replaced. Only `tale restore` puts a snapshot's volumes back.

## Bifrost 1.6 → 2.2: the model gateway's store is migrated

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

Find those callers before the upgrade and plan their replacement. A caller that needs a model's answer can move to the governed model endpoints that releases with API contract 3.7.0 or later offer. They differ from the 0.3 layer: the base URL is `/api/v1/openai`, or `/api/v1/anthropic` for Anthropic clients, rather than `/api/v1`; `model` names a model as `<providerSlug>/<modelId>`, never an agent; image generation is not served; and the endpoints are off until an Admin turns on **Model endpoints for API keys** under **Settings > Governance > Models**. From then on, every call passes model access, the input guardrails, and the budgets. The model endpoints reach the models through the same model gateway as managed agents. Scripted questions for the workspace assistant move to the asynchronous REST chat API, which answers as the assistant rather than as a bare model. Editor integrations that want Tale's knowledge use the MCP endpoint, and work that should run inside Tale, in a sandbox and with a person's review, goes to a project agent on a task. [Use Tale from your editor or a script](/develop/use-tale-from-your-editor) describes each path.
