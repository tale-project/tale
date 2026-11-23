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
- [ ] `APP-F40` · **In a third shell, while the deploy of `APP-F2` waits between `Switching traffic to <colour>...` and `Detached <earlier colour> from the serving networks.`, run `docker run --rm --network tale-sandbox-net --entrypoint sh "$(docker inspect --format '{{.Config.Image}}' <project>-<colour>-platform-1)" -c 'getent ahostsv4 backend-api | cut -d" " -f1 | sort -u; for i in $(seq 20); do curl -s -o /dev/null -w "%{http_code} " http://backend-api:8080/; done'`** → it lists two addresses, the new colour's and the earlier colour's on `tale-sandbox-net`, and prints `404` twenty times and never `000`: a client that is handed the earlier colour first, which has no relay and refuses port 8080, connects to the new colour's relay.
- [ ] `APP-F41` · **Before `APP-F2`, make a project with one task, `Reply with the word ready.`; in the window of `APP-F40`, start the task with the standard agent** → the run ends with the agent's answer, `ready`: the agent's model calls reached the new colour's relay while the earlier colour still answered the same name.
- [ ] `APP-F3` · **Run `docker ps -a --format '{{.Names}}' | grep '^<project>-'`** → the live colour has exactly one application container, `<project>-<colour>-platform-1`; no container of the other colour and none named `backend-api` or `backend-worker` is left.
- [ ] `APP-F4` · **Run `docker inspect <project>-<colour>-platform-1 --format '{{range $name, $net := .NetworkSettings.Networks}}{{$name}} {{$net.Aliases}}{{println}}{{end}}'`** → the `<project>_internal` line holds `platform`, `platform-<colour>`, `backend-api` and `backend-api-<colour>`; the `tale-sandbox-net` line holds `backend-api` and `backend-api-<colour>`, and no `platform`.
- [ ] `APP-F5` · **In a browser, sign in with the account made on the earlier release, open its chat, send a message, upload a document and wait until it reads as indexed** → the page loads, the reply streams and the document is indexed: the web tier, the API and the job runner, all in the one container.
- [ ] `APP-F6` · **Send a chat message that makes the assistant run code, such as `Run this Python and tell me the output: print(6 * 7)`** → the reply shows the code ran and gives `42`: a sandbox session reached the API under the name `backend-api`.
- [ ] `APP-F7` · **Run `tale logs backend-api --tail 5`, then `tale logs backend-worker --tail 5`** → each exits `0`, says the colour runs that service inside `platform`, and prints lines of `<project>-<colour>-platform-1`.
- [ ] `APP-F8` · **Run `docker inspect <project>-<colour>-platform-1 --format '{{.HostConfig.MemoryReservation}} {{.HostConfig.Memory}} {{.Config.StopTimeout}}'`, then `docker inspect <project>-sandbox --format '{{range .Config.Env}}{{println .}}{{end}}' | grep SANDBOX_RESERVED_MEMORY`** → on a cgroup v2 host that sets no reservation variable the first reads `268435456 12884901888 120` and the second `SANDBOX_RESERVED_MEMORY=476m`.
- [ ] `APP-F39` · **Run `docker exec <project>-<colour>-platform-1 cat /sys/fs/cgroup/memory.low /sys/fs/cgroup/memory.max`, then `docker logs <project>-<colour>-platform-1 2>&1 | grep 'Node flags'`** → on a cgroup v2 host whose `.env` sets no reservation variable and no `BACKEND_NODE_FLAGS` the first prints `268435456` and `12884901888`: the container reads the reservation and the limit Docker wrote into its own cgroup. The log line ends `Node flags: --max-semi-space-size=4 --optimize-for-size (container memory limit: 12288 MiB, memory reservation: 256 MiB)`, with no `--max-old-space-size`: the reservation sized Node, and nothing caps its heap.
- [ ] `APP-F15` · **Leave the app untouched for a minute, then run `docker exec <project>-db psql -U tale -d postgres -Atc "select application_name, datname, count(*) from pg_stat_activity where backend_type = 'client backend' and pid <> pg_backend_pid() group by 1, 2 order by 1, 2"`** → the counts add up to about ten and to no more than 15: at most 4 named `postgres.js` on `tale_app`, at most 4 named `tale-backend` (the job queue's three and the one that listens), at most 2 with no name (sign-in sessions) and at most 5 named `postgres.js` on `tale_knowledge`.

## Retire the model gateway · the workspace of the group above · 20 min

The earlier release ran the sandbox LLM gateway, which the model relay in the
backend replaced. A deploy retires it once the live backend says no key the
gateway minted is open; the first deploy of this release asks the earlier
release's backend, which cannot say. The chat the earlier release made ran no
agent turn in a sandbox, so no such key is open. **Run this group before any
other `tale deploy` without `--services`: the first of them retires the
gateway.**

- [ ] `APP-F31` · **Read the output of the deploy in `APP-F2`, then run `docker ps -a --format '{{.Names}} {{.Status}}' | grep llm-gateway`** → the deploy printed `Kept the model gateway <project>-sandbox-llm-gateway as it is: the backend could not say whether keys it minted are still open (…)` with a reason that names a `404`, and went on to the new colour; the command prints `<project>-sandbox-llm-gateway Up …`, up since before the deploy.
- [ ] `APP-F32` · **Run `tale stop`, then `docker ps -a --format '{{.Names}} {{.Status}}' | grep llm-gateway`, then `tale start`, then the `docker ps` command again** → `tale stop` names `<project>-sandbox-llm-gateway` in the group with `<project>-sandbox`, and the first command prints a status that begins `Exited`; `tale start` exits `0`, and the second prints `Up …`.
- [ ] `APP-F42` · **Delete the `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD` line from the workspace's `.env`, run `tale deploy --services platform`, then `grep -c '^SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD=.' .env` and `docker exec <project>-<colour>-platform-1 sh -c 'test -n "$SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD" && echo set'`** → the deploy exits `0` and prints `Put SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD back into .env from the model gateway <project>-sandbox-llm-gateway, which is still there: …`, never the password itself; `grep` prints `1`, the `docker exec` prints `set`, and the command of `APP-F31` still prints the gateway `Up …`.
- [ ] `APP-F33` · **Run `tale deploy --dry-run`, then the `docker ps` command of `APP-F31`** → the preview exits `0` and prints `[DRY-RUN] Would retire the model gateway <project>-sandbox-llm-gateway: no key it minted is open. Its volume <project>_llm-gateway-data would be kept.`; the container is still up.
- [ ] `APP-F34` · **Run `tale deploy`, then `docker ps -a --format '{{.Names}}' | grep llm-gateway` and `docker volume ls --format '{{.Name}}' | grep llm-gateway`** → the deploy exits `0` and prints `Retired the model gateway <project>-sandbox-llm-gateway: no key it minted is open, …`, naming `<project>_llm-gateway-data` and `docker volume rm <project>_llm-gateway-data`; the first command prints nothing, the second prints `<project>_llm-gateway-data`.
- [ ] `APP-F35` · **Send a chat message that makes the assistant run code, as in `APP-F6`** → the reply shows the code ran and gives `42`: the session reached its model through the relay, with no gateway running.
- [ ] `APP-F36` · **Run `tale backup`, then `tale restore` and `docker run --rm -v <project>_backups:/backups:ro alpine:3.22 ls /backups/<the new snapshot>`** → the listing marks no snapshot for leaving the gateway out, and the snapshot holds no `llm-gateway-data.tar.gz`.

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
workspace says so where it wants the earlier sizes. A running database keeps
its sizes through a plain `tale deploy`; a deploy that recreates it gives it
the profile.

- [ ] `APP-F17` · **Run `tale deploy --services db`, then `docker exec <project>-db psql -U tale -d postgres -Atc "select name || '=' || current_setting(name) from unnest(array['shared_buffers','work_mem','maintenance_work_mem','max_connections','autovacuum_max_workers','max_parallel_workers_per_gather']) as name"`** → the deploy exits `0` and recreates `<project>-db` alone; the command prints `shared_buffers=32MB`, `work_mem=4MB`, `maintenance_work_mem=32MB`, `max_connections=40`, `autovacuum_max_workers=1` and `max_parallel_workers_per_gather=0`, and `docker logs <project>-db 2>&1 | grep '^Profile:'` prints `Profile: small`.
- [ ] `APP-F18` · **Search the knowledge base for a phrase from the document indexed in `APP-F5`, in the app's chat** → the answer cites the document: full-text and vector search work on the small database.
- [ ] `APP-B3` · **Add `DB_PROFILE=tiny` to the workspace's `.env` and run `tale deploy`** → it exits `3` with `DB_PROFILE must be small, standard, or unset; got: "tiny"` before it pulls an image; `docker ps` lists the same containers as before, and the settings of `APP-F17` are unchanged.
- [ ] `APP-F19` · **Change the line to `DB_PROFILE=standard`, add `DB_WORK_MEM=64MB`, run `tale deploy --services db`, then run the `psql` command of `APP-F17` again** → the deploy exits `0` and recreates `<project>-db`; the command prints `shared_buffers=256MB`, `work_mem=64MB`, `maintenance_work_mem=128MB`, `max_connections=100`, `autovacuum_max_workers=3` and `max_parallel_workers_per_gather=2`, and the app signs in and answers a chat message. Remove both lines and run `tale deploy --services db` again to return to the small profile.

## Turn the token provider on and off · the workspace of the group above · 15 min

The provider of YouTube's proof-of-origin tokens is a container a workspace
asks for. The earlier release started it with every deployment.

- [ ] `APP-F20` · **Run `docker ps -a --format '{{.Names}}' | grep bgutil`, and read the output of the deploy in `APP-F2`** → the command prints nothing, and the deploy printed `Removed the bgutil-provider sidecar: video links get no PO tokens for YouTube unless VIDEO_INGEST_POT_PROVIDER=true is in .env.`
- [ ] `APP-F21` · **Add `VIDEO_INGEST_POT_PROVIDER=true` to the workspace's `.env`, run `tale deploy`, then `docker ps --format '{{.Names}} {{.Status}}' | grep bgutil` and `docker inspect <project>-<colour>-platform-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep VIDEO_INGEST_POT_PROVIDER`** → the deploy exits `0`; `<project>-bgutil-provider` is up and healthy within a minute, and the application's environment holds `VIDEO_INGEST_POT_PROVIDER=true`.
- [ ] `APP-F22` · **Paste a YouTube link into a chat message and wait for its chip to settle, then run `tale logs bgutil-provider --tail 20`** → the chip reads Ready, or fails with a reason that does not name the token provider, and the log shows the provider answering token requests.
- [ ] `APP-B4` · **Change the line to `VIDEO_INGEST_POT_PROVIDER=yes` and run `tale deploy`** → it exits `3` with `VIDEO_INGEST_POT_PROVIDER must be true, false, or unset; got: "yes"` before it pulls an image, and `<project>-bgutil-provider` is still running.
- [ ] `APP-F23` · **Remove the line, run `tale deploy`, then `docker ps -a --format '{{.Names}}' | grep bgutil`** → the deploy prints that it removed the sidecar, and the command prints nothing.

## Read a large file on a small host · the workspace of the group above · 15 min

The one process reads a file in a process of its own and gives it 96 MiB,
which a workspace raises where its host has memory to spare.

- [ ] `APP-F24` · **Run `docker inspect <project>-<colour>-platform-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep HEAVY_SLOT`** → it prints `HEAVY_SLOT_MEMORY_MB=96` and nothing else.
- [ ] `APP-F25` · **Make a table of 200,000 rows (`seq 1 200000 | awk '{print $1",2025-01-01,order,42,open,north,EUR,19.90,closed,7"}' > orders.csv`), upload it under Knowledge, and while its badge reads Indexing run `docker top <project>-<colour>-platform-1 -o pid,args | grep heavy-child` every few seconds** → a `heavy-child.js` process is listed while the file is read and none afterwards, and the document reads **Indexed**.
- [ ] `APP-B5` · **Make a text of 60 MB (`yes "2025-01-01,order,42,open" | head -c 60000000 > too-big.csv`), upload it under Knowledge, open its badge once it reads Failed, then run `tale logs platform --tail 100 | grep heavy-slot`** → the dialog says the file needs more memory than the 96 MiB this server gives one file and names `HEAVY_SLOT_MEMORY_MB`; the log has one line `[heavy-slot] reading a .csv file needs more than the 96 MiB one file is given and was not attempted…`; `docker ps` lists `<project>-<colour>-platform-1` with the ID it had, and the app answers a chat message.
- [ ] `APP-F26` · **Add `HEAVY_SLOT_MEMORY_MB=512` to the workspace's `.env`, run `tale deploy`, run the command of `APP-F24` again, then choose Retry indexing on the document of `APP-B5`** → the deploy exits `0`, the command prints `HEAVY_SLOT_MEMORY_MB=512`, and the document reads **Indexed**. Remove the line and deploy again to return to 96 MiB.

## Bring the three services back · the workspace of the group above · 15 min

What a workspace does before it returns to a CLI from before this setting, which
deploys only over the two backend services.

- [ ] `APP-B2` · **Add `TALE_APP_TIER=three` to the workspace's `.env` and run `tale deploy`** → it exits `3` with `TALE_APP_TIER must be one-process, workers-apart, three-services, or unset; got: "three"` before it pulls an image; `docker ps` lists the same containers as before.
- [ ] `APP-F14` · **Change the line to `TALE_APP_TIER=three-services`, run `tale deploy`, then `docker ps --format '{{.Names}}' | grep '^<project>-<colour>-'`** → the deploy exits `0` and prints `Replicas: platform×1, backend-api×1, backend-worker×1`; the live colour is `platform-1`, `backend-api-1` and `backend-worker-1`, and the app signs in, answers a chat message and indexes a document.

## Move the blobs to versitygw · the workspace of the group above · 25 min

The workspace runs MinIO since its earlier release and holds the files the
groups above uploaded. A new install runs versitygw; this one moves its blobs
when a deploy may replace its store. The same `tale deploy --stop` recreates
the database and the edge with the store, and with their memory settings.

- [ ] `APP-F27` · **Run `tale deploy`, then `docker inspect <project>-object-store --format '{{.Config.Image}}'`** → the deploy prints that the blob store stays MinIO, names `<project>_object-store-data`, and that `tale deploy --stop` moves the blobs; the image is `ghcr.io/tale-project/ops/minio:…`.
- [ ] `APP-F28` · **Run `tale deploy --stop`, and while it runs reload a page of the app** → it prints `Moving the blobs from <project>_object-store-data`, then that the application is paused, then `Moved <n> object(s)`; the page answers late while the application is paused and normally after; the store's image is now `ghcr.io/versity/versitygw:…`.
- [ ] `APP-F29` · **In the app, download the files the groups above uploaded and open one** → each downloads under its name and opens as what it is (a PDF as a PDF); `docker volume ls` still lists `<project>_object-store-data`.
- [ ] `APP-F37` · **Run `docker inspect <project>-db <project>-object-store <project>-proxy <project>-sandbox <project>-sandbox-egress --format '{{.Name}} {{.HostConfig.MemoryReservation}} {{.HostConfig.Memory}}'`, then `docker inspect <project>-object-store <project>-proxy --format '{{range .Config.Env}}{{println .}}{{end}}' | grep GOMEMLIMIT`** → on a cgroup v2 host that sets no reservation variable the first prints `/<project>-db 125829120 0`, `/<project>-object-store 36700160 146800640`, `/<project>-proxy 36700160 146800640`, `/<project>-sandbox 20971520 1073741824` and `/<project>-sandbox-egress 10485760 536870912`; the second prints `GOMEMLIMIT=28MiB` twice.
- [ ] `APP-F38` · **Run `docker inspect <project>-object-store <project>-proxy --format '{{.Name}} {{.State.OOMKilled}} {{.RestartCount}}'`, then `docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' <project>-object-store <project>-proxy`** → the first prints `false 0` for each: neither was killed or restarted while it carried the downloads of `APP-F29`; the second shows each below its limit, `140MiB`.
- [ ] `APP-F30` · **Run `tale backup`, upload one more file, then `tale restore <the snapshot> --stop` and `tale deploy --stop`** → the restore names `<project>_blob-data`; the file uploaded after the snapshot is gone, and every file from before downloads and opens as before.
- [ ] `APP-B6` · **Run `tale deploy --stop` again** → it moves nothing: no `Moving the blobs` line, and the store stays versitygw.
