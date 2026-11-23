# @tale/load

Smoke, stress and performance testing for Tale: realistic virtual users against a running
deployment, a realistic mock model provider, a bulk seeder, and reports that say what held, what
broke and why.

It is a separate test. Nothing here runs in the merge gate: the **Load** workflow
(`.github/workflows/load.yml`) is dispatched by hand, the **Memory budget** workflow
(`.github/workflows/memory-budget.yml`) runs nightly, and a distributed run against a real
deployment is started from wherever the generators run. A passing unit test proves a contract; a
passing load run proves the platform held a crowd.

> **Never point a load run at a production deployment.** The seeder creates users and
> organizations, opens sign-up, and the journeys write threads, tasks, documents and API keys.
> Use a deployment built for the test and throw it away afterwards.

## What it is made of

| Part          | Command                | What it does                                                                                                                                                                                                                                                          |
| ------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mock provider | `mock`                 | An OpenAI- and Anthropic-compatible model provider that behaves like a real one: sampled time to first token and token rate, usage that matches the content, prompt-cache hits, tool calls, reasoning, embeddings, model catalog with prices, rate limits and faults. |
| Seeder        | `seed`                 | Builds the population: users, sessions and memberships straight into SQL (one password hash for all), organizations through the API so the platform's own hooks run, each organization configured for the mock provider. Writes the plan file.                        |
| Runner        | `run`                  | Drives one shard of a plan with a load profile across several generator processes, records every request in HDR histograms, reads the server's metrics and statement statistics, and writes a JSON report plus its Markdown rendering.                                |
| Merge         | `merge`                | Folds the reports of a distributed run's shards into one exact distribution.                                                                                                                                                                                          |
| Local stack   | `stack up/down/status` | Runs N `api` and M `worker` processes of the platform from a checkout (plus the mock) against your own database, for horizontal-scaling runs on one machine.                                                                                                          |
| Agent burst   | `burst`                | Starts a burst of agent runs across a project's agents on the host that carries the platform and its sandboxes, samples the host's memory, the spawner's admission, the api's readiness and the kernel's OOM kills meanwhile, and judges whether the host held it.    |
| Memory budget | `budget`               | Reads a `tale deploy` deployment's memory, every container's cgroup v2 `memory.stat` every 250 ms, while the reference workload of tale#4942 runs against it, and judges it against the 500 MB budget. |

Run every command from the repository root with Node 22 (Node runs the TypeScript directly):

```bash
node tools/load/src/cli.ts --help
node tools/load/src/cli.ts run --help
```

## Quick start on one machine

You need Docker, a throwaway database and an object store. The CI workflow is the reference
recipe; by hand:

```bash
# 1. A disposable tale-db and object store
docker run -d --name tale-load-db -p 127.0.0.1:5452:5432 -e DB_PASSWORD=<pw> \
  -e DB_MAX_CONNECTIONS=600 -e DB_SHARED_BUFFERS=1GB ghcr.io/tale-project/tale/tale-db:latest
docker run -d --name tale-load-object-store -p 127.0.0.1:9471:9000 -v /data \
  -e ROOT_ACCESS_KEY=taleload -e ROOT_SECRET_KEY=<pw> \
  ghcr.io/versity/versitygw:v1.11.0 --port :9000 --health /_health --quiet posix --fsync /data

# 2. The platform's environment (see the CI workflow's "Write the stack environment" step):
#    DATABASE_URL, KNOWLEDGE_DATABASE_URL, BETTER_AUTH_SECRET, ENCRYPTION_SECRET_HEX, SITE_URL,
#    TALE_CONFIG_DIR, TALE_CONFIG_BUILTIN_DIR, TALE_ALLOW_OPEN_SIGN_UP=true,
#    TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1, TALE_PROVIDER_KEY_LOADMOCK=<any>, OBJECT_STORE_*.

# 3. Two api processes, one worker and the mock
node tools/load/src/cli.ts stack up --platform services/platform --env-file load.env \
  --api 2 --workers 1 --mock-port 4199

# 4. Seed 5,000 users in organizations of 50 (one more organization holds 500 of them)
TALE_LOAD_DB_URL=postgres://tale:<pw>@127.0.0.1:5452/tale_app \
TALE_LOAD_AUTH_SECRET=<BETTER_AUTH_SECRET> \
node tools/load/src/cli.ts seed --target http://127.0.0.1:4105 --users 5000 --org-size 50 \
  --mega-org-size 500 --provider-base-url http://127.0.0.1:4199/v1 --output plan.json

# 5. Smoke first, then the real run
node tools/load/src/cli.ts run --plan plan.json --profile smoke
node tools/load/src/cli.ts run --plan plan.json --profile load --users 5000 \
  --target http://127.0.0.1:4105,http://127.0.0.1:4106 \
  --metrics http://127.0.0.1:4105/metrics,http://127.0.0.1:4106/metrics \
  --db-url postgres://tale:<pw>@127.0.0.1:5452/tale --report runs/load.json

node tools/load/src/cli.ts stack down
```

`run` and `merge` exit 0 when every threshold held, 1 when one failed and 2 when the harness itself failed (a generator crashed, failed or had to be killed).

## Profiles

| Profile        | Shape                                                                                                                                                              | Question                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `smoke`        | a handful of users, every persona, fast think times, ~2 min                                                                                                        | Does every journey work at all?                                |
| `load`         | ramp to `--users` over `--ramp`, hold `--hold`, wind down                                                                                                          | Does it hold the expected crowd?                               |
| `stress`       | `--steps` equal steps up to `--users`, each held `--hold`; stops at the first step whose p95 or error share breaks (`--breakpoint-p95`, `--breakpoint-error-rate`) | Where does it break? The report names the last step that held. |
| `spike`        | 10 % base, a jump to 100 % in 5 s, back to the base                                                                                                                | Does a sudden crowd recover?                                   |
| `soak`         | the peak for an hour or more                                                                                                                                       | Does it leak or drift?                                         |
| `connections`  | idle open tabs: live streams held, hardly a click                                                                                                                  | What do the open connections alone cost?                       |
| `signin-storm` | every user signs in with the password inside the ramp                                                                                                              | Does a Monday morning hold?                                    |
| `agent-burst`  | the Load workflow's run of `burst`, not a `run` profile: 12 agent runs across 7 agents within 30 s, each turn holding 2 GiB and a CPU                              | Does a 4 vCPU / 16 GB host hold a burst of agent runs?         |

### Reading and running the profiles

- **`signin-storm` needs `--forwarded-for`.** Every virtual user connects from this machine, and the
  platform's sign-in flood guard counts attempts per source address: without per-user addresses all
  of them share one bucket, and a few dozen sign-ins in, every one answers `429` — by design, and
  the same would happen to a real deployment behind a proxy that drops `X-Forwarded-For`. Pass
  `--forwarded-for` to give each user an address of their own.
- **A refused sign-in is an outcome, not a crash.** When more passwords arrive than the process
  hashes at once, the platform answers `503 PASSWORD_CHECK_BUSY` with `Retry-After` instead of
  queuing them (`backend/auth/password-hasher.ts`). The report's server section shows
  `tale_backend_password_checks_waiting`; raise `UV_THREADPOOL_SIZE` on the api, or add an api
  process, to move the line.
- **`soak` holds its peak for at least an hour** (`--hold` below 3,600 s is raised to it). For a
  quick drift check run `--profile load --hold 720` instead and watch the server section's memory.
- **Telling the machine from the platform.** `net_ETIMEDOUT` and `net_UND_ERR_CONNECT_TIMEOUT` are
  TCP-level: the target's listen backlog (`kern.ipc.somaxconn` is 128 on macOS) or a full ephemeral
  port range, not an answer of the platform. A jump of thousands of users in seconds (`spike`,
  `signin-storm`) produces them on a laptop; ramp `connections` over several minutes
  (`--ramp 360` for 5,000 idle tabs) or run the generators from Linux. The platform's own
  failures are the `http_5xx` kinds and the server section's logs.

## Personas and journeys

Each virtual user is one person of the plan (same e-mail, organization and session every run) and
plays one persona, assigned by weight from the user index (`--personas browser=40,chatter=30,…`):

| Persona       | Default share | Mostly does                                                                   |
| ------------- | ------------- | ----------------------------------------------------------------------------- |
| `browser`     | 40 %          | keeps the app open, reads Home, threads, notifications                        |
| `chatter`     | 30 %          | multi-turn conversations, attachments, renames, cancels                       |
| `task-worker` | 15 %          | creates, moves, comments and assigns tasks                                    |
| `knowledge`   | 6 %           | uploads documents and searches the knowledge base                             |
| `admin`       | 3 %           | members, teams, API keys, audit log, settings                                 |
| `api-client`  | 4 %           | the REST API with an API key, polling generations                             |
| `fuzzer`      | 2 %           | malformed and hostile input on purpose: a 4xx is expected, a 5xx is a finding |

A session starts like a browser: authenticate (adopt a minted session, or sign in with the
password for `--password-sign-in-rate` of sessions), run the dashboard boot waterfall, open the
`/events` hint stream, then loop journeys with log-normal think times (`--think-scale` multiplies
them). After a session length drawn around `--session-seconds` the tab closes and a fresh session
of the same person starts. The data people type comes from Faker, seeded per user, in English,
German and French: questions and follow-ups, long pastes, code, task fields, contact records,
documents of 1–200 KB, search queries derived from uploaded content, and hostile strings for the
fuzzer. The journey catalog with every endpoint it calls lives in `src/scenario/journeys/`.

## What a report contains

- **Thresholds** — the built-in service levels (`http.p95 < 1000`, `http.p99 < 3000`,
  `errors.errorRate < 0.01`, `chat.ttft.p95 < 3000`, `chat.ttft.mean < 1500`) or your own
  `--thresholds file.json` (`{"GET /api/app/chat/threads.p95": "<300"}`).
- **Every request and timing** by route template: count, rate, mean, p50/p90/p95/p99, max,
  errors, with error samples. `chat.ttft` is the time from send to the first streamed text, as
  the browser sees it; it includes the mock provider's own time to first token (median 450 ms by
  default). `chat.turn` is send to settle. `realtime.hint_latency` is the time from one user's
  write to another user's hint.
- **The server's side** when `--metrics` is given: requests and mean duration per route as the
  backend timed them, CPU seconds, resident memory, open hint streams, event-loop lag.
- **The database's side** when `--db-url` points at the database holding `pg_stat_statements`
  (the Tale image creates it in `tale`): transactions and rows written per second, connections
  by state, and the statements the run spent the most time on.

## A million users: distributed runs

One generator process holds tens of thousands of virtual users (each is mostly waiting); one
machine holds a few processes. A million users is therefore many generators, each driving one
shard of the same plan:

```bash
# on generator i of N, all pointing at the same deployment
node tools/load/src/cli.ts run --plan plan.json --profile load --users <1M / N> \
  --shard i/N --processes 8 --target https://load.example.com --report shard-i.json

# anywhere, once every shard finished
node tools/load/src/cli.ts merge shard-*.json --out million.json
```

A target behind a private certificate authority (a staging deployment, Caddy's `tls internal`)
stays verified: point `NODE_EXTRA_CA_CERTS` at the authority's root certificate. The harness has
no switch that turns certificate checks off.

Users are partitioned exactly by the shard index (`shardRange` in `src/plan.ts`), so no user runs
twice. Each generator writes its own report; `merge` folds the histograms exactly — percentiles
do not average. Seed once, with the full count, before the generators start.

Size a generator for its connections, not its CPU: each user holds one or two long-lived streams.

| Limit                              | Default                    | For a generator                                                                                                              |
| ---------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| open files                         | 1,024–65,536               | `ulimit -n 1048576`                                                                                                          |
| ephemeral ports per source address | ~28k (Linux), ~16k (macOS) | `sysctl net.ipv4.ip_local_port_range="10000 65000"`; beyond ~55k connections, add addresses and pass `--local-address a,b,c` |
| listen backlog (target side)       | 4,096 (Linux), 128 (macOS) | `net.core.somaxconn` on the deployment's hosts                                                                               |
| TIME_WAIT reuse                    | off                        | `net.ipv4.tcp_tw_reuse=1`                                                                                                    |

macOS is fine for development runs up to roughly 15,000 concurrent connections in total: past
that the generator and the platform's own database connections compete for the same ephemeral
ports on `127.0.0.1` and both fail with `EADDRNOTAVAIL`. Run bigger tests from Linux.

## Agent burst

`burst` asks what one host holds when agent runs arrive together: the 4 vCPU / 16 GB host of
#3977, which carries the platform, its database and the sandboxes the runs execute in. It signs in
as the owner of the plan's first organization and gives the project the largest sandbox budget the
organization may set (`--project-sessions`): the deployment's room but one session for each of its
three other budgets, since an organization's budgets add up to at most the room. The runs beyond
that budget wait for the organization's quota (`org_limit`); the host's admission holds a start
only when the host runs short first. The burst creates `--agents` agents of `--harness`, then
`--runs` tasks spread evenly over `--window` seconds, each in progress and assigned to its agent,
which is what starts its run. Each turn is the mock provider's: the task asks for a command that
holds `--hog-mib` of memory and keeps a CPU busy for `--hog-seconds` (`[[mock:hog]]`, below). Then
it watches the board until every run has ended or `--deadline` passed, and judges:

| Expectation                                          | Judged on                                                                                                                                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every run's turn held its memory and kept a CPU busy | the mock's own counts, read before and after the burst: at least as many hogs ran to their end as the burst started runs (`--mock-metrics`; by default the mock `stack up` recorded in `--stack-state`)  |
| No host-wide OOM kill                                | the kernel log's `Killed process` lines since the burst began, but those inside a session's memory cgroup; when the log is unreadable (`kernel.dmesg_restrict`), any rise of `/proc/vmstat`'s `oom_kill` |
| Available memory stays above the spawner's reserve   | the lowest `MemAvailable`, read every second, against the reserve the spawner's admission answer names (a tenth of the host, at least 1 GiB, without one)                                                |
| No database pool connection timeouts                 | the pool's timeout messages in the api and worker logs `stack up` wrote                                                                                                                                  |
| `/api/health/ready` p95 under 1 s                    | a probe of the api every 250 ms, each given 5 s, none of which may fail: the api's own door, which also reaches its database; `/api/health` is the web tier's, which the stack does not run              |
| Runs beyond the room wait with a visible reason      | every run the platform parked for capacity says why on the board, and no run stays queued, nor a task in progress without a run, longer than `--pending-grace`                                           |
| No run fails for lack of capacity                    | no run fails with `park_deadline`, `sandbox_capacity`, `resource_exhausted`, `start_failed` or `session_gone`                                                                                            |
| Every run of the burst ends settled                  | every task's last run settled before `--deadline`, and no run failed                                                                                                                                     |

A figure that could not be observed misses its expectation: the run is a proof, and a probe that
could not look proves nothing. A burst whose turns never ran their command would hold every other
expectation with ease, so the first one counts the hogs. `burst` exits 0 when every expectation
held, 1 when one missed and 2 when its setup failed; it writes the JSON report and its Markdown
rendering, which lists each task's runs, how long they waited and why, how they ended and what the
last one answered: a hog that ran says how much it held and how long it spun. It also counts the
spawner's admission answers, sampled meanwhile, which say whether the host would have started one
more session and, if not, why. `SANDBOX_TOKEN` signs those reads (`--spawner-url`; `--no-spawner`
skips them).

The Load workflow's `agent-burst` profile is the reference recipe, on a hosted runner of exactly
that size:

- It builds the spawner, its egress proxy and the session runtime from the checkout and starts
  them as `bun dev` does beside a host backend: the `backend-relay` of `compose.dev.yml` carries
  the sessions' `backend-api` to the host's api, which therefore listens on port 3005, and its
  model relay, where a session calls its models, on port 3008 (`SANDBOX_RELAY_PORT`). With more
  than one api process, the first keeps that port and each next one serves its relay one port
  higher; the sessions reach the first.
- The api and the mock listen on every interface (`stack up --listen-host 0.0.0.0`) so the
  `backend-relay` reaches the api across the Docker bridge and the api reaches the mock at the
  bridge's address, while `SITE_URL` stays `http://127.0.0.1:3005`: the platform refuses plain
  HTTP for any other host. A firewall rule drops what reaches those ports, and the mock's metrics
  port, on the runner's own interface.
- The organization's provider is the mock in Anthropic format at the bridge's address: the model
  relay in the api passes Claude Code's own wire through to it unchanged.
- Swap is off, so a shortage of memory shows as one rather than as slowness, and the kernel log is
  open to the job's user.

By hand, on a host that runs the same stack:

```bash
SANDBOX_TOKEN=<the spawner's token> node tools/load/src/cli.ts burst --plan plan.json \
  --stack-state .tale-load-stack.json --report runs/burst.json
```

## Memory budget

`budget` reads what tale#4942 decided (decision of 2026-11-14): a deployment stays within
**500 MB** (500,000,000 bytes, 476.8 MiB) for everything `tale deploy` starts on one host by
default, sandbox sessions and sandbox-lane jobs aside, at its peak across a stated workload, on
native Linux amd64 and arm64. The decision's figures (the limit, each part's share and the
overlap bound) are written once, in `packages/shared/src/memory-budget.ts`
(`@tale/shared/memory-budget`), where the CLI takes each service's memory reservation from too;
`src/budget/limits.ts` adds how the benchmark reads them.

**The reading.** Every 250 ms, each container's cgroup v2 `memory.stat` is read, one container
after the other within one turn of the event loop. `anon + shmem + slab_unreclaimable +
kernel_stack + pagetables + sock` are counted; the page cache, `file`, is reported beside them
and not counted (it includes the `shmem` that is counted). The deployment's reading at an instant
is the sum over its containers at that instant, and the result is the peak of that sum, with the
instant and what each container held then. Each container's own peak, its page cache then and
its own peak page cache are reported too.

**The containers** are found as the CLI finds them, by Compose's labels: the stateful project
(`<id>`, the `id` in the workspace's `tale.json`: `db`, `object-store`, `proxy`, `docker-api`,
`sandbox`, `sandbox-egress`) and one project per colour of the app tier (`<id>-blue`,
`<id>-green`: `platform`), each container that Compose made (a container number, no one-off).
The sessions the spawner starts carry no Compose project, so they are left out by construction.
A container's cgroup is found from its main process (`/proc/<pid>/cgroup`, narrowed to the
segment that names the container; a path that names no container is not taken), and else at the
conventional path of the engine's driver (`system.slice/docker-<id>.scope` for systemd,
`docker/<id>` for cgroupfs). A container whose cgroup is one another container is read from is
not read, since its memory would count twice, and is named. The list is read again every second,
each container's process by one `docker inspect`, or by one per container where that fails (it
fails as a whole when a container stopped since the listing): a container that starts is read
from then on, one that stops is read no more, and nothing is carried over from an instant it was
not read at. Two colours of the app tier at one instant are a blue/green overlap: outside the
ceiling, bounded to one extra app-tier share. At such an instant the smaller colour's app tier is
reported as the overlap and left out of the deployment's reading. An engine the reading does not
hold on is refused before anything runs (exit 2): cgroup v1, a rootless engine (`name=rootless`
among its security options) and the `none` cgroup driver, whose containers have no cgroup of
their own under the host's tree.

**The workload** is the decision's: finding 1's, plus a spreadsheet and a PDF indexed at the
same time, one transcription and ten sign-ins. Every person is a browser of their own
(`createBrowserAgent` and `BROWSER_HEADERS` in `src/client/http.ts`): their own connections to
the deployment, HTTP/2 where the edge offers it in the TLS handshake, every answer decoded as a
browser decodes it, and a browser's `Accept-Encoding: gzip, deflate, br, zstd` and
`Accept-Language` on every request, event stream and upload, so the deployment answers as it
answers a browser: the app's precompressed files, and the edge's compression of the rest. Before
the reading starts, the plan's first organization's owner pins the standard agent to pi
(`--harness`) and to the plan's model and makes it the project's agent, seven people sign in,
and the reference files are made (`src/data/reference-files.ts`: a 60,000 × 10 spreadsheet of
15 MB written by SheetJS, a 300-page text PDF, ten minutes of 16 kHz mono WAV). After `--settle`
seconds at rest every part starts at once:

| Part | What happens | Done when |
| --- | --- | --- |
| Chat | six people open the app as a browser does — the start page and the files it loads, the dashboard's reads, their organization's dashboard and its reads, the app's event stream, Home's reads — then start a conversation and send four turns each, reading each reply first | all 24 turns settle `completed`, and every page, file and read of the app was answered and no event stream refused |
| `run_code` | a seventh opens the app the same way and asks for a chart; the mock answers with a `run_code` call (`[[mock:run-code]]`) | the turn completes and its `run_code` result is `ok` |
| Agent task | the owner hands a task to the standard agent, in progress | its run ends `settled` on pi as a run of the `harness` engine: one on another runtime, or on the engine a chat reply runs on, is not the task the decision names |
| Documents | the owner uploads the spreadsheet and the PDF together into the documents | both are indexed (`completed`) |
| Transcription | the owner uploads the recording as the composer does | its transcription is `completed` (not `skipped`) |
| Sign-ins | once both documents are handed over for indexing, ten more people sign in at once, each from a browser of their own | ten sign-ins (a refusal for load is asked again after its `Retry-After`) |

Opening the app (`src/api/page.ts`; the reads are `src/api/dashboard.ts`'s, which a virtual user
of `run` boots with too) fetches `/` and `/dashboard/<org>`, each file the document names that a browser
fetches to show it (scripts, style sheets, module preloads, the manifest, icons) and the modules
those scripts import statically, each once per person and six at a time, as a browser keeps and
fetches them. The modules the app imports on demand once it runs (a screen's own code, a
locale's messages) are not fetched: which of them a screen needs is decided by running the app,
and the harness does not run it. So a first visit's largest files, the app's entry and vendor
modules, are in the reading, and a screen's own chunks are not.

A part did not complete when it says what went wrong: a turn, a page, a file or a read that
failed, an event stream the deployment refused (401, 403, 404) or stopped, a run on the wrong
runtime. The report counts the HTTP errors the whole run met, by request and kind: every
unexpected answer, failed connection and stream error.

The workload ends when every part has ended or `--deadline` passed. With `--flip-command`, that
command runs next while the reading goes on: a blue/green flip of the app tier, the workspace's
`tale deploy`, which starts the other colour beside the live one, waits for it, drains the old
one and stops it (every deploy without `--services` does, the same release included); it is
stopped after `--flip-deadline` seconds (900). Then the reading goes on for `--tail` seconds.

**The verdict** holds four expectations, each held, missed, inconclusive or not tested. The run
fails (exit 1) when one missed, is inconclusive (exit 2) when none missed and one is
inconclusive, and passes (exit 0) otherwise:

| Expectation | Held when | Otherwise |
| --- | --- | --- |
| Every container of the deployment is read every 250 ms | each service of `--services` was read; no running container was left unread, read with failures or read from another's cgroup; no gap over a second between instants; never five seconds without a listing | inconclusive: the reading is a lower bound |
| The reference workload runs to its end | every part completed | missed: a deployment that did less held less |
| The deployment stays within 500,000,000 bytes | the peak is within the limit on a whole reading | missed when the peak is above the limit, on a whole reading or not, since what a reading missed can only add to it; inconclusive when it is within on a reading that is not whole |
| A blue/green overlap adds at most one app-tier share (256 MiB) | a flip overlapped two colours within the bound on a whole reading, and finished | missed above the bound, on a whole reading or not; not tested without `--flip-command`, deciding nothing; inconclusive when a flip was asked for and no instant read two colours, or the flip failed or ran out of time within the bound |

Each part's peak is also read against its share (app tier 256 MiB, Postgres 120, object store 35,
edge 35, spawner and egress 30): informative, it decides nothing. The report's title gives the
peak and the limit in bytes, and so does a miss's account of how far over it went: a peak a few
kilobytes over never reads as equal to the limit. The run writes the JSON report, its Markdown
rendering and every instant as CSV (`--report budget.json` writes `budget.md` and `budget.csv`
beside it). A setup that fails exits 2 before anything is read.

**In CI**, `.github/workflows/memory-budget.yml` runs it on a fresh hosted runner of each
architecture: it builds the stack's images from the checkout into a registry on the runner
(`tools/cli/e2e/incus/images.sh`), builds the CLI as that release, deploys with `tale init` and
`tale deploy` as an operator does (`GHCR_REGISTRY` pointed at the registry; the site on
`https://localhost`, its edge terminating TLS with the certificate of its own local authority,
whose root, `/data/pki/root.crt` in the edge's container, the harness trusts through
`NODE_EXTRA_CA_CERTS`), starts the mock where the platform reaches it (`host.docker.internal`),
seeds one organization of 18 and runs `budget` with the workspace's `tale deploy` as its
`--flip-command`. The deploy step prints the HTTP version the edge answered with. Swap is off, so
nothing the deployment holds is swapped out of `anon`.

It runs on every push to a release line (`release/**`) that changes what the deployment or the
benchmark is built from (the stack's services, the packages, the platform's configs, the
patches, `compose.yml`, the CLI, this tool, the manifests and the lockfile, the setup action or
the workflow), and nightly and on dispatch. GitHub starts a scheduled workflow, and offers a
dispatched one, only from the default branch's copy of the file, which does not carry a release
line's work: on a line, the push runs the line's own copy, on the code it measures. A run in
progress finishes, and newer pushes to the same line wait in one pending run that measures the
newest; a scheduled or dispatched run is never cancelled.

**By hand**, on the host that runs the deployment (rootful Docker with cgroup v2; the reading
needs the host's `/proc` and `/sys/fs/cgroup`), with the mock where the platform reaches it and
the workspace's `.env` carrying `TALE_ALLOW_OPEN_SIGN_UP=true`,
`TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1` and `TALE_PROVIDER_KEY_LOADMOCK`. A deployment whose edge
certifies itself (`TLS_MODE=selfsigned`, `tale init`'s default) is verified against its own
root, never with certificate checks off. From the workspace's directory:

```bash
node tools/load/src/cli.ts mock --host 0.0.0.0 --port 4199 --tool-call-rate 0 \
  --rate-429 0 --rate-5xx 0 --mid-stream-error-rate 0
docker exec "$(jq -r .id tale.json)-proxy" cat /data/pki/root.crt > root.crt
export NODE_EXTRA_CA_CERTS="$PWD/root.crt"
node tools/load/src/cli.ts seed --target https://localhost --users 18 --org-size 18 \
  --provider-base-url http://host.docker.internal:4199/v1 --output plan.json
node tools/load/src/cli.ts budget --plan plan.json --project "$(jq -r .id tale.json)" \
  --flip-command 'tale --yes deploy --skip-backup' --report runs/budget.json
```

`--services` names the services a whole reading must include (the default stack's seven);
`--cgroup-root`, `--proc` and `--docker` say where the readings and the engine are. The sampler's
own lab test reads a real systemd scope: `TALE_LOAD_CGROUP_LAB=1 bun test tests/budget/lab.test.ts`.

## The mock provider

```bash
node tools/load/src/cli.ts mock --port 4199 --processes 4 --ttft-median-ms 450 --rate-429 0.002
```

Every option is also an environment variable (`TALE_LOAD_MOCK_TTFT_MEDIAN_MS`, …); `--help`
lists them. It serves `GET /v1/models`, `POST /v1/chat/completions` (streaming and not, title
calls, tools, reasoning, `stream_options.include_usage`), `POST /v1/messages` (Anthropic),
`POST /v1/embeddings` (deterministic unit vectors of any width), image, speech, transcription
and moderation stubs, `GET /health` and Prometheus metrics prefixed `tale_load_mock_`: on its own
port, or with `--processes` above 1 the merged metrics of every process on `--metrics-port`, by
default the next one (`stack up` records where as `mockMetricsUrl`). A message may force a
behaviour with a directive: `[[mock:429]]`, `[[mock:500]]`, `[[mock:503]]`,
`[[mock:midstream-error]]`, `[[mock:stall=<ms>]]`, `[[mock:ttft=<ms>]]`, `[[mock:tokens=<n>]]`,
`[[mock:tool]]`, `[[mock:no-tool]]`, `[[mock:empty]]` (`run --provider-fault-rate` sends them).
`[[mock:run-code]]` answers a chat turn that offers the light sandbox's `run_code` with a call of
it: a Python program that draws a bar chart with matplotlib into `/agent/output/`
(`src/mock/run-code.ts`); the request carrying its result is answered in prose. `budget` sends it.
The catalog lists one speech-to-text model, `load-transcribe` (type `transcription`, priced per
second of audio), so an organization configured for the mock transcribes recordings with it.
`[[mock:hog=<MiB>]]` answers a turn that offers a shell tool (Claude Code's `Bash`, Codex's
`shell`) with a call of it that holds that much memory, every page written, and keeps a CPU busy
for `[[mock:hog-seconds=<s>]]` (60 by default); the next request, which carries the result, is
answered in prose that quotes it, so the turn ends. `tale_load_mock_hog_calls_total` counts the
hog calls its replies delivered, `tale_load_mock_hog_results_total` the results that came back
from a hog that ran to its end. `burst` sends the directive and reads both (`src/mock/hog.ts`).

It is deliberately not the platform's e2e gateway (`services/platform/lib/mocks`): that one is
deterministic, so a test can assert an exact reply; this one is statistical, so a crowd looks
like a crowd.

## Development

```bash
bun run --filter @tale/load typecheck
bun run --filter @tale/load lint
bun run --filter @tale/load test
```

Tests use `bun test` and touch nothing but `127.0.0.1` on ephemeral ports. Code that a test runs
imports undici as `undici/index.js`: under Bun, the bare `undici` resolves to Bun's own stub.
