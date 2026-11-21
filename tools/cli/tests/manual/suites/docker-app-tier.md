# The application tier on Docker

> **Prefix** `APP-` · **Reset** the host's snapshot before the first group · **Cost** per group, in its heading

How `tale deploy` runs the application on Docker Compose: one `platform`
process that is the web tier, the API and the job runner, the job runners apart
in `backend-worker`, or the three services an image from before needs. The unit
suites judge every decision and every generated document over a fake Docker
command line ([automation](../reference/automation.md)). This suite judges what
only a real engine shows: one container answering two serving names, the edge
routing both sets of routes to it, and a handover between a colour of three
services and a colour of one while requests run.

**The groups run in order on one host: each starts from the workspace the group
before it left.**

## Preconditions

A Linux host with Docker Engine and its Compose plugin, the compiled `tale`
under test and a name the workspace is reached under, per
[`../setup.md`](../setup.md). The first group also needs the compiled `tale` of
the last release whose image runs the application as three services.

> **Agent note**: judge a colour by `docker ps` and by the public URL after a
> command returns. A container that exists and a name that answers are
> different states, and so are a web tier that is healthy and an API that
> serves.

## Hand over from three services to one process · a workspace on the earlier release · 30 min

Deploy the earlier release first, with its own `tale`, and make an account, one
chat and one indexed document in it.

- [ ] `APP-F1` · **With the `tale` under test, run `tale update`, then `tale deploy --dry-run`** → the preview exits `0`; it prints `Rotatable services: platform` and `Would deploy 1× platform in <project>-<idle colour>`, and names no `backend-api` or `backend-worker` it would deploy. Where the image is not on the host yet, one line says the preview shows the services an image of this release runs.
- [ ] `APP-F2` · **In a second shell start `while sleep 1; do curl -sS -o /dev/null -w '%{http_code}\n' https://<host>/api/health/ready; done`, run `tale deploy`, then stop the loop** → the deploy exits `0`, and the loop printed `200` on every line: the handover dropped no request.
- [ ] `APP-F3` · **Run `docker ps -a --format '{{.Names}}' | grep '^<project>-'`** → the live colour has exactly one application container, `<project>-<colour>-platform-1`; no container of the other colour and none named `backend-api` or `backend-worker` is left.
- [ ] `APP-F4` · **Run `docker inspect <project>-<colour>-platform-1 --format '{{range $name, $net := .NetworkSettings.Networks}}{{$name}} {{$net.Aliases}}{{println}}{{end}}'`** → the `<project>_internal` line holds `platform`, `platform-<colour>`, `backend-api` and `backend-api-<colour>`; the `tale-sandbox-net` line holds `backend-api` and `backend-api-<colour>`, and no `platform`.
- [ ] `APP-F5` · **In a browser, sign in with the account made on the earlier release, open its chat, send a message, upload a document and wait until it reads as indexed** → the page loads, the reply streams and the document is indexed: the web tier, the API and the job runner, all in the one container.
- [ ] `APP-F6` · **Send a chat message that makes the assistant run code, such as `Run this Python and tell me the output: print(6 * 7)`** → the reply shows the code ran and gives `42`: a sandbox session reached the API under the name `backend-api`.
- [ ] `APP-F7` · **Run `tale logs backend-api --tail 5`, then `tale logs backend-worker --tail 5`** → each exits `0`, says the colour runs that service inside `platform`, and prints lines of `<project>-<colour>-platform-1`.
- [ ] `APP-F8` · **Run `docker inspect <project>-<colour>-platform-1 --format '{{.HostConfig.MemoryReservation}} {{.HostConfig.Memory}} {{.Config.StopTimeout}}'`, then `docker inspect <project>-sandbox --format '{{range .Config.Env}}{{println .}}{{end}}' | grep SANDBOX_RESERVED_MEMORY`** → on a cgroup v2 host that sets no reservation variable the first reads `268435456 12884901888 120` and the second `SANDBOX_RESERVED_MEMORY=768m`.
- [ ] `APP-F15` · **Leave the app untouched for a minute, then run `docker exec <project>-db psql -U tale -d postgres -Atc "select application_name, datname, count(*) from pg_stat_activity where backend_type = 'client backend' and pid <> pg_backend_pid() group by 1, 2 order by 1, 2"`** → the counts add up to about ten and to no more than 15: at most 4 named `postgres.js` on `tale_app`, at most 4 named `tale-backend` (the job queue's three and the one that listens), at most 2 with no name (sign-in sessions) and at most 5 named `postgres.js` on `tale_knowledge`.

## Replace the one process in place · the workspace of the group above · 10 min

- [ ] `APP-F9` · **Note the ID `docker ps -q --filter name=<project>-<colour>-platform-1` prints, run `tale deploy --services platform`, then print the ID again** → the deploy exits `0`, warns that it replaces the live colour's replicas in place, and prints `Draining in-flight chat turns and automation steps on the <colour> api...` before it recreates the container; the ID changed, the colour did not, and the app answers again.
- [ ] `APP-B1` · **Note the container's ID, run `tale deploy --services backend-api`, then print the ID again** → it exits `3` with `The <colour> colour runs platform: it has no backend-api to update.` and the advice to name a service the colour runs; the ID is the same.

## Run the job runners apart, and together again · the workspace of the group above · 20 min

- [ ] `APP-F10` · **Add `TALE_BACKEND_WORKER_REPLICAS=2` to the workspace's `.env`, run `tale deploy`, then `docker ps --format '{{.Names}}' | grep '^<project>-<colour>-'`** → the deploy exits `0` and prints `Replicas: platform×1, backend-worker×2`; the live colour is `platform-1`, `backend-worker-1` and `backend-worker-2`.
- [ ] `APP-F11` · **Run `docker inspect <project>-<colour>-platform-1 <project>-<colour>-backend-worker-1 --format '{{.Name}} {{range .Config.Env}}{{println .}}{{end}}' | grep -E '^/|TALE_ROLE'`** → `platform-1` names `TALE_ROLE=api` and `backend-worker-1` names `TALE_ROLE=worker`.
- [ ] `APP-F12` · **Upload a document and wait until it reads as indexed, then run `tale logs backend-worker --tail 20`** → the document is indexed, and the command prints lines of `<project>-<colour>-backend-worker-1` and names the other replica.
- [ ] `APP-F16` · **Run `docker inspect <project>-<colour>-platform-1 --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}'`, then `docker exec <project>-db psql -U tale -d postgres -Atc "select client_addr, count(*) from pg_stat_activity where application_name = 'tale-backend' group by 1"`** → the row of an address of `platform-1` counts at most 2: it sends jobs and works none, so it holds no connection to be woken on. The row of each worker counts more, at most 11.
- [ ] `APP-F13` · **Remove the variable from `.env`, run `tale deploy`, then list the colour's containers and `TALE_ROLE` as above** → the live colour is `platform-1` alone again, with `TALE_ROLE=all`, and the app still signs in, answers a chat message and indexes a document.

## Size the database for the host · the workspace of the group above · 15 min

The database the application shares its host with starts small, and a
workspace says so where it wants the earlier sizes.

- [ ] `APP-F17` · **Run `docker exec <project>-db psql -U tale -d postgres -Atc "select name || '=' || current_setting(name) from unnest(array['shared_buffers','work_mem','maintenance_work_mem','max_connections','autovacuum_max_workers','max_parallel_workers_per_gather']) as name"`** → it prints `shared_buffers=32MB`, `work_mem=4MB`, `maintenance_work_mem=32MB`, `max_connections=40`, `autovacuum_max_workers=1` and `max_parallel_workers_per_gather=0`, and `docker logs <project>-db 2>&1 | grep '^Profile:'` prints `Profile: small`.
- [ ] `APP-F18` · **Search the knowledge base for a phrase from the document indexed in `APP-F5`, in the app's chat** → the answer cites the document: full-text and vector search work on the small database.
- [ ] `APP-B3` · **Add `DB_PROFILE=tiny` to the workspace's `.env` and run `tale deploy`** → it exits `3` with `DB_PROFILE must be small, standard, or unset; got: "tiny"` before it pulls an image; `docker ps` lists the same containers as before, and the settings of `APP-F17` are unchanged.
- [ ] `APP-F19` · **Change the line to `DB_PROFILE=standard`, add `DB_WORK_MEM=64MB`, run `tale deploy`, then run the command of `APP-F17` again** → the deploy exits `0` and recreates `<project>-db`; the command prints `shared_buffers=256MB`, `work_mem=64MB`, `maintenance_work_mem=128MB`, `max_connections=100`, `autovacuum_max_workers=3` and `max_parallel_workers_per_gather=2`, and the app signs in and answers a chat message. Remove both lines and deploy again to return to the small profile.

## Turn the token provider on and off · the workspace of the group above · 15 min

The provider of YouTube's proof-of-origin tokens is a container a workspace
asks for. The earlier release started it with every deployment.

- [ ] `APP-F20` · **Run `docker ps -a --format '{{.Names}}' | grep bgutil`, and read the output of the deploy in `APP-F2`** → the command prints nothing, and the deploy printed `Removed the bgutil-provider sidecar: video links get no PO tokens for YouTube unless VIDEO_INGEST_POT_PROVIDER=true is in .env.`
- [ ] `APP-F21` · **Add `VIDEO_INGEST_POT_PROVIDER=true` to the workspace's `.env`, run `tale deploy`, then `docker ps --format '{{.Names}} {{.Status}}' | grep bgutil` and `docker inspect <project>-<colour>-platform-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep VIDEO_INGEST_POT_PROVIDER`** → the deploy exits `0`; `<project>-bgutil-provider` is up and healthy within a minute, and the application's environment holds `VIDEO_INGEST_POT_PROVIDER=true`.
- [ ] `APP-F22` · **Paste a YouTube link into a chat message and wait for its chip to settle, then run `tale logs bgutil-provider --tail 20`** → the chip reads Ready, or fails with a reason that does not name the token provider, and the log shows the provider answering token requests.
- [ ] `APP-B4` · **Change the line to `VIDEO_INGEST_POT_PROVIDER=yes` and run `tale deploy`** → it exits `3` with `VIDEO_INGEST_POT_PROVIDER must be true, false, or unset; got: "yes"` before it pulls an image, and `<project>-bgutil-provider` is still running.
- [ ] `APP-F23` · **Remove the line, run `tale deploy`, then `docker ps -a --format '{{.Names}}' | grep bgutil`** → the deploy prints that it removed the sidecar, and the command prints nothing.

## Bring the three services back · the workspace of the group above · 15 min

What a workspace does before it returns to a CLI from before this setting, which
deploys only over the two backend services.

- [ ] `APP-B2` · **Add `TALE_APP_TIER=three` to the workspace's `.env` and run `tale deploy`** → it exits `3` with `TALE_APP_TIER must be one-process, workers-apart, three-services, or unset; got: "three"` before it pulls an image; `docker ps` lists the same containers as before.
- [ ] `APP-F14` · **Change the line to `TALE_APP_TIER=three-services`, run `tale deploy`, then `docker ps --format '{{.Names}}' | grep '^<project>-<colour>-'`** → the deploy exits `0` and prints `Replicas: platform×1, backend-api×1, backend-worker×1`; the live colour is `platform-1`, `backend-api-1` and `backend-worker-1`, and the app signs in, answers a chat message and indexes a document.
