---
title: Customize Compose
description: Scale the application tier, overlay the shipped compose file, and know which containers stay a singleton.
---

Every process that serves a request in Tale is replaceable: sessions are database rows, chat progress is a generation row, hints ride an outbox, and writes to the config store are serialized by a lock the database holds. That is what lets `platform`, `backend-api` and `backend-worker` run as more than one container each. This page is for the operator whose queue is backing up or whose API is saturating — the replica knobs, what raising one actually costs, which containers can never be replicated, and how to change something the CLI does not expose without forking files `git pull` will overwrite.

## Scale a role

The three application roles each read one environment variable from the deployment's `.env`. Defaults are one replica each; values outside `1`–`16` are clamped with a warning rather than refused.

| Variable                       | Scales                                   | Raise it when                                                                                                 |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `TALE_BACKEND_WORKER_REPLICAS` | The job runner                           | Ingestion, crawls, automations, or agent turns queue up behind each other. The cheapest and safest one to raise. |
| `TALE_BACKEND_API_REPLICAS`    | Every API door, auth, and the hint stream | Request latency rises under concurrency, or SSE connections are the ceiling.                                    |
| `TALE_PLATFORM_REPLICAS`       | The web tier that serves the app shell   | Rarely — it serves static assets and injects env; the API is almost always the bottleneck first.                |

Set them and deploy. The counts apply on the next `tale deploy`, which brings up the whole colour at the new size:

```bash
# In the project's .env
TALE_BACKEND_WORKER_REPLICAS=3
TALE_BACKEND_API_REPLICAS=2

tale deploy
```

Under `Blue (active) Services:`, `tale status` then lists one row per replica — `backend-api #1`, `backend-api #2`, and so on, each with its own health and version. A role at one replica keeps its plain name. That is deliberate: a colour that came up two-of-three is visible in the listing rather than averaged into a single healthy row.

<Warning>

Count the deploy window, not the steady state. A deploy runs both colours at once, so `TALE_BACKEND_API_REPLICAS=4` means **eight** API containers for the length of the drain. Each backend container carries a 12 GB memory cap for its ingest subprocesses; that is a ceiling rather than a reservation, but the peak is real. Size for it before you raise a count on a host that is already tight.

</Warning>

## What scaling does not fix

More replicas move a bottleneck; they do not remove one.

- **A saturated database.** Every replica shares one Postgres. If queries are the ceiling, more clients make it worse. Move the knowledge corpus off the box first — [Data residency](/self-hosted/configuration/data-residency) is that walk.
- **A slow model provider.** Agent turns wait on the provider, not on CPU. Extra workers wait in parallel.
- **A single large job.** Replicas divide a queue, not a job. One 4-hour crawl still takes 4 hours.

## Leave these as singletons

Four services cannot be replicated, and the reason differs for each.

| Service                      | Why one                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `db`, `object-store`         | They **are** the durable state. Two would be two copies of the truth.                                       |
| `proxy`                      | It owns the host's ports and the certificate store.                                                        |
| `sandbox`, `sandbox-egress`  | The spawner holds the Docker socket and the session directory on the host filesystem; sessions are pinned to it. |
| `sandbox-llm-gateway`        | It owns the single `llm-gateway-data` volume, which holds the virtual keys minted per session.              |

Scaling any of them is not a supported topology, and `tale deploy` will not do it.

## Overlay a change the CLI does not expose

Extra environment, an extra mount, a sidecar of your own — anything the CLI has no flag for goes in an overlay file, so `git pull` never overwrites it. Which file, and whether Compose reads it at all, depends on how you installed.

| You installed with           | Overlay file                          | Read automatically         |
| ---------------------------- | ------------------------------------- | -------------------------- |
| `tale init` then `tale dev`  | `compose.override.yml` in the project root | Yes — `tale dev` layers it |
| A clone of this repository   | `compose.local.yml`, passed with `-f` | No — pass it yourself      |
| `tale deploy`                | None                                  | The CLI generates compose inline |

<Note>

`tale deploy` composes the stack from generated files and ignores both overlay names. On a production CLI install, the supported knobs are the environment variables in `.env` — the replica counts above and the [Environment reference](/self-hosted/configuration/environment-reference). An overlay is for the clone and for `tale dev`.

</Note>

Create the file next to the shipped `compose.yml`. Compose merges keys last-file-wins, so this is the only file you edit after a pull:

```yaml
# compose.local.yml — extra worker concurrency, louder platform logs
services:
  backend-worker:
    environment:
      WORKER_CONCURRENCY: '8'
  platform:
    environment:
      LOG_LEVEL: debug
```

Bring the stack up with the overlay last, and confirm the merge before starting containers:

```bash
docker compose -f compose.yml -f compose.local.yml config --services
docker compose -f compose.yml -f compose.local.yml up -d
```

<Check>

`config --services` lists every service in the merged graph. On the same files, `config --format json` shows `WORKER_CONCURRENCY` as `8` on `backend-worker` and no `container_name` on `backend-api` or `backend-worker` — which is what lets Compose replicate them there.

</Check>

On a clone, `--scale` is the direct equivalent of the replica variables for the two backend roles. The clone's `platform` keeps a pinned `container_name` (`tale-platform`) because the troubleshooting runbooks address it by that name, so it stays a singleton there; on a `tale deploy` stack it scales like the rest.

```bash
docker compose -f compose.yml -f compose.local.yml up -d --scale backend-worker=3
```

## What an overlay must not change

These edits look local and break the stack.

| Change                                                    | Why it breaks                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Pin `container_name` on `backend-api` or `backend-worker`  | `--scale` then fails — two containers cannot share one name                        |
| Scale any service in the singleton table above            | Each owns a volume, a socket, or a host port the rest of the stack hard-codes      |
| Rename the `config-data` volume                           | Docker cannot rename a volume; the new name mounts an **empty** one and every organization loses its configuration |
| Edit `compose.yml` in place                               | The next `git pull` overwrites it                                                  |
| Publish `5432` or `8003` on a public host                 | Those ports are for the clone's inner loop, not production                         |

## Where this fits

You now have a size for each role, a file you own on top of the shipped graph, and the list of containers that stay one no matter the load. [Upgrades](/self-hosted/operate/upgrades) is what a deploy does with those replicas — including why the host briefly runs two of everything. [Container architecture](/self-hosted/operate/container-architecture) is what each container does when one of them dies, and the [Environment reference](/self-hosted/configuration/environment-reference) is every variable an overlay or a `.env` might set. Capacity that is not more replicas is a store move: [Data residency](/self-hosted/configuration/data-residency) for the knowledge corpus and for an organization's own bucket under **Settings > Data residency**.
