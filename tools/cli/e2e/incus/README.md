# The CLI on Incus: end-to-end against a real node

The unit tests of the CLI's Incus runtime (`src/lib/runtime/incus`, the managed path in
`src/lib/deployment`) run against an in-memory Incus. This directory is what shows them right:
the compiled CLI, built from the checkout, driven through the managed path against a real
Incus node, with the stack's images built from the same checkout.

It runs in CI (`.github/workflows/cli-incus-e2e.yml`) and, by hand, on a lab VM. In CI the
node is the one `services/sandbox/e2e/incus/lab.sh` builds (`install`, `storage`, `api`,
`registry`: Zabbly's pinned Incus, a ZFS pool on a file, a pinnable server certificate, a
local registry on `127.0.0.1:5000`). `CI ready (CLI Incus E2E)` reports the run; while the
runtime is experimental it blocks a pull request only on the paths the runtime owns
(`.github/CI.md`, "CLI Incus E2E").

## The lab

| Piece | What it is |
| --- | --- |
| `harness.ts` | the lab from the environment, the CLI runner (every line it prints goes to `logs/cli.log`), the node's administrator, and the managed deployment the suites share: prepared, bootstrapped and deployed once, whichever suite asks first |
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
| `logs` | a running console is not read without `--consume`; `--since` is refused; `--follow --consume` warns once, polls, and shows every line once until the service ends; the compiled `tale logs` still refuses a workspace on Incus |
| `crash-loop` | a service that exits at once is read by `tale logs` while it crashes, then ends stopped once `boot.autorestart` gives up, and is reported "stopped after repeated crashes" with the console Incus kept |
| `stop` | Postgres shuts down cleanly under Incus's stop and starts with no recovery; the worker hears SIGTERM and drains; both inside the timeout, never killed |
| `sandbox` | a session the stack's spawner makes resolves and reaches the backend API and the LLM gateway, and nothing else: no other name, and the database, the platform, the proxy and the Incus API stay closed |
| `export-client` | the credential export of a managed native client: private files, an exact replay. Off unless `TALE_E2E_NATIVE_CLIENT=1` (Known findings) |
| `secrets` | no generated secret and no declared one reaches any line the CLI printed, a refusal, a plan, a receipt, a bundle or a report |

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
