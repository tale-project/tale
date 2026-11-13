# The CLI on Incus: end-to-end against a real node

The unit tests of the CLI's Incus runtime (`src/lib/runtime/incus`, the managed path in
`src/lib/deployment`) run against an in-memory Incus. This directory is what shows them right:
the compiled CLI, built from the checkout, driven through the managed path against a real
Incus node, with the stack's images built from the same checkout.

It runs in CI (`.github/workflows/cli-incus-e2e.yml`) and, by hand, on a lab VM. The managed
suites drive the managed path; the workspace suites drive a workspace (`tale init`,
`tale deploy`, `tale backup`, `tale runtime migrate`) on the same node. In CI the
node is the one `services/sandbox/e2e/incus/lab.sh` builds (`install`, `storage`, `api`,
`registry`: Zabbly's pinned Incus, a ZFS pool on a file, a pinnable server certificate, a
local registry on `127.0.0.1:5000`). `CI ready (CLI Incus E2E)` reports the run; while the
runtime is experimental it blocks a pull request only on the paths the runtime owns
(`.github/CI.md`, "CLI Incus E2E").

## The lab

| Piece | What it is |
| --- | --- |
| `harness.ts` | the lab from the environment, the CLI runner (every line it prints goes to `logs/cli.log`), the node's administrator, and the managed deployment the suites share: prepared, bootstrapped and deployed once, whichever suite asks first |
| `workspace.ts` | the workspace the workspace suites share: the CLI built as releases N and N+1, `tale init` with the Incus runtime, bootstrap and the first deploy, once; a CLI run killed when the journal reaches a phase; streams, attributed load and a sandbox session's load through the edge; a row in the database to read back |
| `load.ts` | pollers through the stack's edge and the windows a target did not serve |
| `images.sh` | the eight Tale images of a managed stack, built from the checkout with the labels the managed path verifies, pushed to the lab's registry as `tale-project/tale/tale-<service>:sha-<revision>`, and the object store's image copied beside them |
| `suites.sh` | the suites a run was asked for, as the workflow's step outputs |
| `harness.test.ts` | the parts that need no node: an ordinary unit test |

The specification declares the lab's registry as `runtime.incus.registryMirrors` for
`ghcr.io`: the CLI and Incus then read Tale's images as a release names them,
`ghcr.io/tale-project/tale/...`, pinned by the digests the lab's registry proved. The upgrade's
second release is the checkout plus an empty commit, whose images differ by their revision
label alone.

## The suites

Each suite builds on the deployment the harness keeps, so it runs alone as well as after the
others. The workflow runs them in this order (`suites.sh`).

| Suite | What it proves on a real node |
| --- | --- |
| `bootstrap` | `tale incus contract` names the lab; `tale incus bootstrap --spec` makes the projects, bridges, ACLs, profiles, trust entries and the state directory's credentials, and a second run changes nothing; `tale incus check` reads the node back with the restricted certificate, probes included; that certificate reaches its own project alone and cannot make one |
| `managed` | `deploy prepare` reads every image from the registry with no Docker; the first deploy's plan creates everything and changes nothing; `deploy --bundle` brings every instance up, records the ready receipt, and the stack answers through the edge; the next release's plan names the in-place window, and its deploy is refused without a recovery snapshot, changing nothing |
| `fresh-noop` | the plan of the bundle the stack runs is empty, and a second `deploy --bundle` recreates, restarts and reconfigures nothing |
| `logs` | a running console is not read without `--consume`; `--since` is refused; `--follow --consume` warns once, polls, and shows every line once until the service ends; the compiled `tale logs` refuses a workspace on Incus without its credentials |
| `crash-loop` | a service that exits at once is read by `tale logs` while it crashes, then ends stopped once `boot.autorestart` gives up, and is reported "stopped after repeated crashes" with the console Incus kept |
| `stop` | Postgres shuts down cleanly under Incus's stop and starts with no recovery; the worker hears SIGTERM and drains; both inside the timeout, never killed |
| `sandbox` | a session the stack's spawner makes resolves and reaches the backend API and the LLM gateway, and nothing else: no other name, and the database, the platform, the proxy and the Incus API stay closed |
| `export-client` | the credential export of a managed native client: private files, an exact replay. Off unless `TALE_E2E_NATIVE_CLIENT=1` (Known findings) |
| `flip` | twenty flips of the workspace under HTTP, server-sent event streams, a 1 Hz `/api/health` poller and a sandbox session calling the backend, all but the session through the edge: no 5xx, edge 502/503/504, maintenance page or `UPSTREAM_UNAVAILABLE`; the retired colour serves nothing new after its withdrawal window (by serving identity); a stream ends only at the retirement of its colour and reconnects at once |
| `streams` | a stream opened on the new colour during a flip survives the rest of it and an in-place roll of the other role; a roll of its own role ends one replica's streams at a time, and each reconnects |
| `infra-skew` | release N+1's CLI defers release N's switch and resolvers (same instance, image and upstream files) while the colours move to N+1; `--stop` replaces them with N+1's image and the same files |
| `services-rollback` | `--services platform` rolls the live colour's platform replicas alone, under load; `tale rollback` flips back from N+1 to N under load, every replica admitted |
| `resume` | the CLI killed (SIGKILL) while a colour comes up, right after its admission, with the old colour withdrawn, and in an in-place roll with a replica withdrawn: the next deploy resumes and ends with one colour, every replica admitted, no marker left |
| `withdraw-restart` | both withdrawal markers made as uid 0 in a platform and a backend replica, the replica restarted outside the CLI: it boots, its admission probe answers 200 and it is admitted, with no failed request |
| `backup` | a native snapshot restores its data; an archived one exports to a file, imports and restores; prune keeps every listed snapshot restorable |
| `reset-keeps-backups` | after `reset --all` the newest set, archived into `backups`, restores into a fresh deploy |
| `restore-history` | a restore, a deploy, then a restore to an older snapshot; the CLI killed once a volume is stopped, detached, renamed, copied and attached: `deploy` and `start` refuse and make no volume, `--resume` and `--abort` (in turn) converge |
| `reboot` | `incus admin shutdown` stops the stop groups in order; the restart brings back the last state, highest start priority first, every replica admitted. It stops the whole node: only with `TALE_E2E_HOST_RESTART=1` |
| `migrate` | a Docker deployment on the same host moves to Incus (`DOCKER-USER` rules applied as bootstrap names them; Docker's edge stopped before the Incus edge exists; the row written on Docker read on Incus); a dockerd restart (`TALE_E2E_RESTART_DOCKERD=1`) leaves Docker's `proxy` stopped. It needs the compose plugin and the host's ports 80 and 443 free, and skips without them |
| `secrets` | no generated secret and no declared one reaches any line the CLI printed, a refusal, a plan, a receipt, a bundle or a report |

The workspace suites (`flip` to `migrate`) share a workspace of their own on the same node,
`<name>-ws`. A workspace deploys the release its CLI was built as, and a rollback needs two
releases a patch apart, so `workspace.ts` compiles the CLI of the checkout twice, as releases
N and N+1 (`TALE_E2E_RELEASES`), and the registry carries the images under both versions
(`images.sh` with `TAG`). Main's switched roles serve no WebSocket (the 0.5 backend replaced the
Convex socket with HTTP and the `/events` hint stream), so the streams these suites hold are
server-sent events; the edge's one WebSocket lane, `/sandbox/tunnel`, reaches the spawner, which
a flip never touches.

`bun test` does not pick the suites up by itself (their names end in `.e2e.ts`), and each
refuses to start without `TALE_E2E_LAB=1`, so the workspace's test run never needs a node.

## Running it

In CI it is the workflow. A draft is held; dispatch it on the branch instead:

```sh
gh workflow run cli-incus-e2e.yml --ref <branch>
gh workflow run cli-incus-e2e.yml --ref <branch> -f suites=bootstrap,managed,logs
```

By hand, on a lab whose Incus you may use (the user in `incus-admin`), name every object after
the run and point the harness at it:

```sh
export TALE_E2E_LAB=1 TALE_E2E_DIR=$HOME/e2e/run TALE_E2E_NAME=e2e-lab TALE_E2E_POOL=e2e-lab
export TALE_E2E_SUBNET=10.220.0.0/22 TALE_E2E_GATEWAY=10.220.0.1 TALE_E2E_BLOCK=10.220.1.0/25
export TALE_E2E_SESSIONS=10.221.0.0/24 TALE_E2E_ENDPOINT=https://<an address the server certificate names>:8443
export TALE_E2E_REGISTRY=127.0.0.1:<a port skopeo may use without TLS>
export TALE_E2E_REVISION=<the checkout's commit> TALE_E2E_REPO=<a clean checkout at it>
export TALE_E2E_NEXT_REVISION=<an empty commit on top> TALE_E2E_NEXT_SOURCE=<a checkout at it>
bash tools/cli/e2e/incus/images.sh "$TALE_E2E_REGISTRY" "$TALE_E2E_REVISION" 0.0.0
bash tools/cli/e2e/incus/images.sh "$TALE_E2E_REGISTRY" "$TALE_E2E_NEXT_REVISION" 0.0.0
TAG=0.5.901 bash tools/cli/e2e/incus/images.sh "$TALE_E2E_REGISTRY" "$TALE_E2E_REVISION" 0.5.901
TAG=0.5.902 bash tools/cli/e2e/incus/images.sh "$TALE_E2E_REGISTRY" "$TALE_E2E_NEXT_REVISION" 0.5.902
bun run --filter @tale/cli build:host && bun run --filter @tale/cli build:backend-local
TALE_E2E_CLI=$PWD/tools/cli/dist/tale bun run --filter @tale/cli test:e2e:incus
```

The CLI must be built from a clean, committed checkout: `deploy prepare` refuses any other.

| Variable | Default (the CI lab) | What |
| --- | --- | --- |
| `TALE_E2E_DIR` | none | the run's directory: specifications, bundles, state, `logs/cli.log`, `report/*.json` |
| `TALE_E2E_NAME` | `cli-e2e` | the stack, its project and bridge (at most 15 characters) |
| `TALE_E2E_POOL` | `tank` | the ZFS pool |
| `TALE_E2E_SUBNET`, `TALE_E2E_GATEWAY`, `TALE_E2E_BLOCK` | `10.20.0.0/22`, `10.20.0.1`, `10.20.1.0/25` | the stack bridge and the managed `/25` |
| `TALE_E2E_SESSIONS` | `10.21.0.0/24` | the sandbox zone |
| `TALE_E2E_ENDPOINT` | `https://<gateway>:8443` | the API the CLI and the spawner dial |
| `TALE_E2E_REGISTRY` | `127.0.0.1:5000` | the registry that stands in for `ghcr.io` |
| `TALE_E2E_DOCKER_MIRROR` | `mirror.gcr.io:443` | the host that stands in for Docker Hub (empty: none) |
| `TALE_E2E_REVISION`, `TALE_E2E_REPO` | none, this checkout | the first release and a checkout at it |
| `TALE_E2E_NEXT_REVISION`, `TALE_E2E_NEXT_SOURCE` | none | the release it upgrades to and a checkout at it |
| `TALE_E2E_VERSION` | `0.0.0` | the version label of both releases' images |
| `TALE_E2E_CLI` | `tools/cli/dist/tale` | the compiled CLI, with `tale.mjs` beside it |
| `TALE_E2E_INCUS`, `TALE_E2E_ROOT` | `incus`, nothing | how the administrator runs `incus` and bootstrap (`sudo /usr/bin/incus`, `sudo -E` in CI) |
| `TALE_E2E_NATIVE_CLIENT` | off | declare the native client the credential export needs |
| `TALE_E2E_WS_NAME` | `<name>-ws` | the workspace's project and bridge |
| `TALE_E2E_WS_SUBNET`, `TALE_E2E_WS_GATEWAY`, `TALE_E2E_WS_BLOCK` | `10.22.0.0/22`, `10.22.0.1`, `10.22.1.0/24` | the workspace's bridge and its `/24` |
| `TALE_E2E_WS_SESSIONS` | `10.23.0.0/24` | the workspace's sandbox zone |
| `TALE_E2E_RELEASES` | `0.5.901,0.5.902` | the workspace's releases N and N+1, a patch apart |
| `TALE_E2E_FLIPS` | `20` | how many flips `flip` runs |
| `TALE_E2E_MG_NAME`, `TALE_E2E_MG_SUBNET`, `TALE_E2E_MG_GATEWAY`, `TALE_E2E_MG_BLOCK`, `TALE_E2E_MG_SESSIONS` | `<name>-mg`, `10.24.0.0/22`, `10.24.0.1`, `10.24.1.0/24`, `10.25.0.0/24` | the Incus stack `migrate` moves to |
| `TALE_E2E_HOST_RESTART` | off | let `reboot` shut the whole node down |
| `TALE_E2E_RESTART_DOCKERD` | off | let `migrate` restart dockerd |

## What the lab cannot prove yet

Each is a `test.todo` with its body in place (`bun test --todo` runs them):

- **accept** reads the release from the declared origin over HTTPS. The lab's origin resolves
  nowhere and nothing terminates TLS in front of its edge, and on Incus there is no
  private-origin container to dial instead.
- **The release upgrade's window.** A changed existing deployment on Incus is refused until the
  CLI can take its recovery snapshot there (the next milestone); the suite holds that refusal,
  and the measurement of the in-place window waits for it.

## Known findings

- **observe** stops at its filesystem inventory on Incus: it measures each mount's source as a
  host path, and an Incus mount's source is a volume of the pool.
- **A managed native client** is created on the first deploy, but the call reports a failure,
  and the next deploy refuses the client as one that differs from the configured one. The
  credential export needs that client, so its suite is off by default.
- **The spawner's zone** (`SANDBOX_INCUS_PROJECT`, `SANDBOX_INCUS_PROFILE`,
  `SANDBOX_INCUS_NETWORK`, `SANDBOX_INCUS_STORAGE_POOL`) comes from the specification's
  environment; the spawner refuses to start without the four, and nothing refuses their
  absence before the deploy reaches it.
