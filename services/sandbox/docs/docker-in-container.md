# Native `docker` / `docker compose` inside sandbox sessions

The sandbox can let a session agent run native `docker` and `docker compose`
**inside** its container. This is opt-in and deployment-wide. It is **not
policy-blocked on any tier** — per the "one codebase, the operator configures the
host to their security needs" model, every tier may enable it; the trade-offs are
loud boot warnings, not hard refusals.

## The model

The container runtime is a **deployment-level, uniform choice** — the same for
every tenant in a deployment, never per-org. It is selected by a **tier**:

| Tier (`SANDBOX_RUNTIME`) | docker `--runtime` | k8s `runtimeClassName` | docker-in-container                                                     |
| ------------------------ | ------------------ | ---------------------- | ----------------------------------------------------------------------- |
| `runc` (default)         | `runc`             | _(none)_               | **privileged, no boundary** — trusted-only ⚠️                           |
| `gvisor` (alias `runsc`) | `runsc`            | `gvisor`               | **experimental** — runsc contains it, but nested networking is flaky ⚠️ |
| `sysbox`                 | `sysbox-runc`      | `sysbox-runc`          | **native, unprivileged** — recommended ✅                               |
| `kata`                   | `kata`             | `kata`                 | native, VM-isolated ✅                                                  |

Docker-in-container is enabled with `SANDBOX_DOCKER_IN_CONTAINER=true`. It is
an **agent-profile capability** — a `default`-profile session (run_code, crawler
renders) never starts an inner daemon, on either backend.

Within a DinD-enabled agent session, Docker starts automatically on the first
connection to its standard socket. The agent uses ordinary `docker` and
`docker compose` commands; no separate activation command is needed.
Concurrent first commands share one engine startup. After five minutes with
no connected clients, the engine stops only when its inventory confirms no
running, restarting or paused containers and no enabled restart policies.
An unavailable or unknown inventory
keeps it running. A later command restarts it against the same Docker store.
This reduces idle processes; the session retains its configured runtime
boundary, privileges and resource limits throughout.

Health checks do not start the engine or reset its idle timer. An intentionally
sleeping engine remains ready for new work. runnerd's `/healthz` reports the
engine as `docker: { engine, used }`: `cold` until the first Docker command,
`running` while it starts or runs, `stopped` after it slept or failed, with
`used` true once it has run in this container. A released session whose engine
never ran gets the normal released idle window, since it has no image store a
resume would lose. A failed probe refuses new work
while runnerd stays live, but one slow probe does not cause session cleanup.
Probe-based recovery requires at least three completed failures spanning five
seconds; cached reads do not count again, and a healthy result or a new engine
clears the engine's failure history. A confirmed startup failure or unexpected
engine exit can request recovery immediately. The spawner reclaims such a
session only through its atomic idle claim, preserving pinned or busy sessions
and the workspace. Stopping the whole session on Docker removes its ephemeral
inner Docker store; the automatic idle stop of just the inner engine keeps it.
A real Docker request can attempt engine recovery.

During a rolling upgrade, keep old spawners pinned to their existing runtime
image until they are replaced. Do not move a runtime tag still used by an old
spawner: it cannot distinguish a transient probe failure from confirmed failure.
When the new spawner encounters an older runtime, unhealthy sessions refuse new
work and retain the normal idle and lifetime cleanup limits.

### What each tier means for DinD

- **`sysbox`** maps in-container uid 0 to an unprivileged host subuid via a
  per-container user namespace, so a rootful inner daemon is **not** host root.
  **`kata`** runs the pod in a microVM with its own kernel. Both keep the "no
  host privilege / no cross-tenant" floor — the recommended paths.
- **`runc`** has no boundary between in-container root and host root, so DinD
  runs the inner daemon `--privileged`: **in-container root IS host root**. It
  works perfectly and needs zero extra host setup, but a container escape (or a
  tenant who simply runs `docker run -v /:/host …`) owns the node. Only safe for
  **fully-trusted / single-tenant** deployments. The spawner logs a loud warning
  at boot.
- **`gvisor`** is itself a strong sandbox (runsc intercepts syscalls), so it
  _contains_ DinD safely — but its user-space netstack + partial iptables
  commonly **break nested-container networking** (inner bridge/DNS/port
  publishing and the in-pod egress fence). Security is fine; functionality is
  not guaranteed — treat it as experimental. The spawner logs a loud warning.

There are no hard refusals: choosing a tier + enabling DinD is the operator's
explicit decision, informed by these warnings.

## Enabling it

`SANDBOX_DOCKER_IN_CONTAINER` has a **tier-aware default**, so the safe path is
zero-config:

| Tier             | Default | Why                                                             |
| ---------------- | ------- | --------------------------------------------------------------- |
| `sysbox`, `kata` | **on**  | boundary-keeping → docker just works once the runtime is set up |
| `runc`, `gvisor` | **off** | runc = privileged host-root (opt-in only); gvisor = flaky       |

So on `sysbox`/`kata` you only need to select the tier + install the runtime —
DinD is on automatically. On `runc` you additionally set the flag (an explicit,
warned opt-in into the host-root path). An explicit value always wins over the
default.

### Configuration

Either env (on the `sandbox` service):

```
# sysbox: DinD is on by default — just select the tier
SANDBOX_RUNTIME=sysbox

# runc: privileged host-root, must opt in explicitly
SANDBOX_RUNTIME=runc
SANDBOX_DOCKER_IN_CONTAINER=true
```

…or the deployment config (`deployment.json`, mounted read-only into the
spawner — overrides the env):

```json
{
  "version": 1,
  "sandboxRuntime": { "tier": "sysbox", "dockerInContainer": true }
}
```

After editing `deployment.json`, restart the spawner so it re-reads at boot:
`docker compose restart sandbox`.

### Host install — Sysbox (Docker backend)

1. Install Sysbox CE on the host (registers the `sysbox-runc` OCI runtime):
   `apt install sysbox-ce` on Ubuntu/Debian, then it registers itself in
   `/etc/docker/daemon.json` and restarts `dockerd`.
2. Verify: `docker info | grep -i sysbox` shows `sysbox-runc`.
3. Kernel ≥ 5.12 (for ID-mapped mounts; your nodes likely already qualify) — no
   shiftfs needed on modern kernels.

Sysbox runs on the **host** Docker daemon; the spawner only mounts the socket.

### Cluster install — Kubernetes

- **Sysbox**: deploy `sysbox-deploy-k8s` (DaemonSet) on the nodes, which
  installs Sysbox and registers a `sysbox-runc` RuntimeClass. Ubuntu nodes only;
  not compatible with most managed default node pools.
- **Kata**: deploy `kata-deploy` (DaemonSet) on **bare-metal or nested-virt**
  nodes and register the `kata` RuntimeClass.

On startup with DinD enabled, the K8s backend logs a loud reminder that the
RuntimeClass must exist and that this path is **unvalidated on a cluster until
you confirm the node prereqs** — a pod NetworkPolicy alone does **not** contain
inner-DinD egress.

If your cluster registers the class under a different name (e.g. `kata-qemu`),
override it with `SANDBOX_RUNTIME_CLASS`.

## Security & isolation

- **Boundary.** The floor is held by the runtime (Sysbox userns / Kata VM), not
  by container flags. Under DinD the session container drops `--cap-drop=ALL` /
  `no-new-privileges` / read-only-root and starts as uid 0 so the inner daemon
  can run — all confined to the userns/VM. The entrypoint drops back to the
  agent user (uid 10001) for the coding agent (so Claude Code's
  `bypassPermissions`, refused as root, still works).
- **No host socket.** The host `/var/run/docker.sock` is never mounted into a
  tenant container; the inner daemon is a fresh `dockerd` in the container's own
  namespaces.
- **Egress is open, and nested docker reaches it transparently.** Egress is
  default-open (no `SANDBOX_EGRESS_ALLOWLIST`): the session — and through it the
  inner daemon — reaches any host via the egress proxy. Inner containers get the
  internet **transparently**, with **no proxy env injected**: the entrypoint runs
  `redsocks` and an iptables `REDSOCKS` nat chain that REDIRECTs nested
  containers' _public_ TCP (matched by the private inner source pool selected at
  startup, preferring `172.31.0.0/16` when it does not overlap the outer routes
  or the planned organization build network)
  through the egress proxy via `CONNECT` (both `:80` and `:443`), while internal /
  private / loopback traffic stays direct. External **DNS** is served by a
  `dnsmasq` forwarder on the (dual-homed) egress proxy — the inner daemon is
  pointed at it with `--dns`, so nested containers resolve public names even
  though their bridge is `--internal`. That's what lets `docker compose up
--build` (apt/pip) **and** runtime services that phone home (e.g. a gateway
  fetching remote config) both work. Because nothing sets `HTTP(S)_PROXY` inside
  the containers, app self-/sibling healthchecks (incl. busybox `wget` that
  ignores `no_proxy`) are never hijacked. If you turn on
  `SANDBOX_EGRESS_ALLOWLIST`, include your registry + package-mirror hosts; the
  tinyproxy `ConnectPort` is `80` + `443`.
- **IMDS fence.** The one always-on network rule blocks inner containers from
  the cloud metadata endpoint + link-local (`169.254.0.0/16`), installed in the
  `DOCKER-USER` chain so it actually takes effect. (link-local also stays direct,
  not redirected to the proxy.) Broader internal lockdown — RFC1918 /
  cross-tenant — is a follow-up tied to the egress allowlist; today the
  `--internal` network keeps inner containers off any non-proxied route.
- **Secrets.** The session's own env (LLM key, `GITHUB_TOKEN`, …) is **not**
  propagated into inner containers (and with transparent egress, neither are
  proxy vars). Don't `docker login` into a path that persists into the shared
  workspace.

## Storage & lifecycle

- **Automatic engine sleep.** Stopping only the idle inner engine preserves
  the workspace, images, named volumes and networks. Its selected address pool
  stays fixed across activations. A session-container restart with existing
  container metadata starts the engine immediately to honor restart policies.
  Running services, enabled restart policies and connected clients prevent
  automatic engine sleep.
- **Store trim before sleep.** When an idle engine's images and build cache
  use more than 10 GiB, it removes its dangling (untagged, unused) images and
  prunes its build cache to the 5 GiB used most recently before it stops, so
  a session that keeps its container (a pinned one) does not grow its inner
  store without bound. Tagged images, images a container uses, containers and
  volumes stay. The trim is bounded and best-effort: a failure is logged and
  the engine stops anyway, and a Docker command arriving during the trim
  keeps the engine running.
- The inner `/var/lib/docker` is a **dedicated, ephemeral per-session volume**
  (Docker backend: a named volume `tale-dind-<session>`; K8s: a size-bounded
  `emptyDir`). It is **not** the workspace (nested overlay is rejected by the
  kernel). Stop and destroy remove the container or Pod and its inner store,
  so image cache does **not** persist across an idle stop/resume (cold rebuild).
  A volume a crash or a missed teardown left behind is removed by the
  five-minute host sweep once no container references it and it is at least
  ten minutes old (younger, it may belong to a create about to mount it).
  On Kubernetes, a runner-container restart within the **same Pod** retains
  the `emptyDir`, including image and network state; it does not provide a
  clean inner store after a crash. The workspace PVC has its own lifecycle
  and survives stop/resume.
- **Restarted inner networks.** After confirming retained inner Docker state,
  the address selector recognizes standard `docker0` and `br-<12hex>` kernel
  bridges as inner networks. Unknown or custom-named bridges remain in the
  observed outer inventory and can block an overlapping pool. Choose
  `SANDBOX_DIND_INNER_POOL` outside every outer Pod, Service and VPC network;
  changing it requires recreating the session container or Pod. A same-Pod
  container restart keeps its existing Pod environment and inner store.
- **Disk bound.** A plain Docker named volume has no hard size cap. Provision
  and verify a quota for each session's volume through host storage; putting
  the Docker data-root on XFS alone does not assign a project quota to each
  named volume. Tale does not configure those quotas. A fixed-size filesystem
  for the entire data-root bounds aggregate use, not individual sessions.
  On K8s the store's `emptyDir.sizeLimit` (`SANDBOX_K8S_DOCKER_STORAGE_SIZE_LIMIT`,
  default `20Gi`) and the Pod's `ephemeral-storage` limit are enforced by
  eviction, which can lag writes.
  **Set a quota before exposing this to untrusted tenants** — an unbounded
  `docker build` loop can fill shared storage. Docker admission also observes
  the workspace filesystem and, where the spawner's hostname bind verifies
  it, Docker's metadata filesystem. This free-space floor pauses new creates;
  it does not constrain already-running writers or observe separately mounted
  volume/containerd stores. See [session admission](sessions.md).
- **Caches.** The shared per-org pip/npm/bun caches are **disabled** under DinD
  (per-container userns shifting makes a shared cross-session volume unsafe).
  Installs still work, just uncached across sessions.

## Reuse builds within an organization

The Docker backend keeps each session's inner `/var/lib/docker` disposable and
shares persistent build caches only among sessions from the same organization.
Optional preparation defaults to five seconds, capped at a quarter of the
session startup budget, and prepares the three mirrors in parallel. Each session stops waiting at its own startup limit and uses its local builder.
The shared producer keeps its independent provisioning budget and organization
lease even if the initiating session stops waiting. Expiry of that shared budget
cancels queued and active work; cancelled queued work cannot launch helpers later. A late result does not attach a network to an already running
session. Registering an available remote buildx builder does not itself start
the session's inner engine.
`SANDBOX_DOCKER_BUILD_CACHE` defaults to the DinD setting. Set it to `false` on
the `sandbox` service, or set `sandboxRuntime.dockerBuildCache` in deployment
configuration, to use only the session's local builder.

The spawner provisions one BuildKit daemon and one internal Docker bridge per
organization. It also provisions three registry mirrors (`docker.io`, `ghcr.io`,
and `quay.io`), each with an organization-specific volume. Names use a bounded,
case-sensitive organization hash; ownership labels are verified before any
resource is reused. The daemon and mirrors have no published ports and do not
join the shared sandbox network.

A session with its organization's build network also starts its inner engine
with the organization's `docker.io` mirror as registry mirror, reached over
plain HTTP on that private network and outside the egress proxy. A `docker pull`
or `docker compose pull` of a Docker Hub image then reuses the layers any
session of the organization already fetched; when the mirror does not answer,
the engine pulls from Docker Hub through the egress proxy as before. The engine
uses registry mirrors for Docker Hub only, so `ghcr.io` and `quay.io` pulls
go upstream.

Sessions join both their organization's build network and the existing control
network. The egress proxy joins the private build network under a local alias;
forwarding rules prevent that proxy and the session's outer interfaces from
routing unsolicited traffic between networks. The builder's RUN steps retain
the transparent proxy and DNS path. A moved egress proxy is reattached and the
builder's stale egress configuration is repaired during provisioning/adoption.

The runtime derives its buildx builder name from the configured endpoint, so
persistent workspaces do not retain an earlier global endpoint by name. A
resumed workspace whose agent user already owns that builder's definition
selects it without starting the Docker CLI; otherwise startup inspects or
creates it. Builder setup failure, including a failure to derive the name,
selects the local builder and never stops the session from starting. A bare remote `docker build` needs
`--load` before the resulting image can run in the session's inner engine.

On upgrade, organization caches start cold. The old global containers are
stopped only after all sessions depending on the old endpoint have stopped;
paused, restarting, starting, and pinned legacy sessions defer this cleanup.
Their volumes and old buildx configuration are retained. Until those sessions
drain, the legacy global service remains reachable on the shared network.
Resources with foreign or missing ownership labels are never stopped or adopted.

This integration currently belongs to the Docker backend. The Kubernetes
backend does not provision this shared BuildKit service. BuildKit's GC caps
each organization's cache at 20 GB and prunes it further, never below 2 GB,
while the shared disk has less than 5% free; registry mirror storage is
separate. The builder is bounded too, since builds run in it rather than in
the session: an agent session's CPUs and twice its memory unless
`SANDBOX_BUILDKITD_CPUS` / `SANDBOX_BUILDKITD_MEMORY` say otherwise. A helper
launched by an earlier release or with other bounds gets its CPU and process
bounds in place at once and is recreated on the current image and memory
bound once no build runs. See
[the BuildKit reference](../../sandbox-buildkitd/README.md) for the resource
boundary and upgrade requirements.

## v1 limitations

- **Public images only.** Private-registry `docker login` / credential handling
  is deferred.
- **Agent sessions only.** The `default` profile (run_code, crawler renders)
  does not get docker.
- **Idle reaper.** A detached `docker compose up -d` service does **not** count
  as session activity; an idle session is stopped and its inner containers go
  with it. Keep an exec live, or pin the session.
- **Resources.** Inner containers share the session's cgroup budget
  (cpu/memory/pids). Usage attribution stays at session granularity. The inner
  `dockerd` and every nested build/run **inherit the session's ulimits and
  cgroup caps**, and the per-coding-agent defaults are too tight to host a real
  `docker compose up --build`, so DinD adjusts them:
  - **`fsize`** is lifted to unlimited (the 512 MiB per-file cap otherwise fails
    layer extraction of any image shipping a larger file — e.g. paradedb's
    ~885 MiB debug symbols — with `EFBIG`). Hard disk bounds require the
    operator-provisioned volume quotas described above; Tale itself checks
    admission headroom, which cannot stop a running build filling the disk. `nofile` is
    raised to a daemon-class range.
  - **`pids`** is raised to 16384 (a parallel multi-service build's
    dockerd + buildkit + N executors blow past the 512 agent default and tools
    die with opaque `fork()`/`dpkg unexpectedly exited` errors). Still a
    fork-bomb ceiling.
  - **memory** default is **8 GiB under DinD** (vs 4 GiB) — a heavy frontend
    bundle (vite) peaks ~7 GiB and is OOM-killed (`exit 137`) at 4 GiB. This is
    a _ceiling, not a reservation_: idle/steady-state DinD sessions sit at
    ~1.5 GiB (mostly reclaimable page cache; ~0.85 GiB real working set), so the
    higher default costs no idle RAM — it only bites during a build. Override
    with `SANDBOX_AGENT_MEMORY`; size host RAM for the concurrent-session peak.
- **K8s** sysbox/kata DinD is implemented but must be validated on a real node
  with the runtime installed (kind nodes can't host it).

## Local testing (Docker backend)

```sh
# 1. install Sysbox on the host
apt install sysbox-ce && docker info | grep -i sysbox

# 2. build the runtime image (ships docker tooling, inert unless DinD is on)
docker build -t tale-sandbox-runtime:dind -f services/sandbox-runtime/Dockerfile .

# 3. run the spawner with the sysbox tier + DinD, create a session, exec in, then:
docker info                 # Storage Driver = overlay2, no errors
cat /proc/self/uid_map      # 0 maps to a large host uid (not 0)
docker compose up           # multi-service, inter-service DNS resolves
docker run --rm alpine wget -T3 http://169.254.169.254/   # MUST fail (egress fenced)
```
