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
**sessions-only** — the one-shot `/v1/execute` path never starts an inner daemon.

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
`docker compose restart sandbox` (or the controller's apply-and-restart with
`services: ["sandbox"]`).

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
- **Egress is open, and nested docker uses it automatically.** Egress is
  default-open (no `SANDBOX_EGRESS_ALLOWLIST`): the session — and through it the
  inner daemon — reaches any host via the egress proxy. Inner **image pulls**
  work because the inner `dockerd` inherits `HTTP(S)_PROXY`. Inner **`docker
build` RUN steps and `docker run` containers do NOT inherit that env**, and the
  `--internal` network gives them no direct DNS — so the entrypoint writes the
  agent's `~/.docker/config.json` `proxies` block, which makes the docker CLI
  auto-inject `HTTP(S)_PROXY`/`NO_PROXY` into every build step and container.
  That's what lets `docker compose up --build` (apt/pip downloads) succeed.
  `NO_PROXY` keeps loopback, the inner pool, and the internal gateways
  (`bifrost`/`convex`) direct. The proxy is HTTPS-CONNECT (`:443`) for https and
  forwards plain http; if you turn on `SANDBOX_EGRESS_ALLOWLIST`, include your
  registry + package-mirror hosts.
- **IMDS fence.** The one always-on network rule blocks inner containers from
  the cloud metadata endpoint + link-local (`169.254.0.0/16`), installed in the
  `DOCKER-USER` chain so it actually takes effect. (Broader internal lockdown —
  RFC1918 / cross-tenant — is a follow-up tied to the egress allowlist; while
  egress is open it would only block the sanctioned proxy, so it's intentionally
  not enabled. Today the `--internal` network is what keeps inner containers off
  any non-proxied route.)
- **Known limitation:** because the proxy env is injected into runtime
  containers too, an inner `docker compose` service that calls another service by
  **hostname** over HTTP (e.g. `http://web`) may get proxy-routed and fail;
  service-to-service by IP (the inner pool, in `NO_PROXY`) and non-HTTP
  (postgres/redis) are unaffected. For app stacks that rely on HTTP-by-name, add
  those names to the build/run `NO_PROXY`.
- **Secrets.** The session's own env (LLM key, `GITHUB_TOKEN`, …) is **not**
  propagated into inner containers; only the proxy vars are. Don't `docker
login` into a path that persists into the shared workspace.

## Storage & lifecycle

- The inner `/var/lib/docker` is a **dedicated, ephemeral per-session volume**
  (Docker backend: a named volume `tale-dind-<session>`; K8s: a size-bounded
  `emptyDir`). It is **not** the workspace (nested overlay is rejected by the
  kernel) and is reaped on both stop and destroy, so a crash never leaves a
  dirty overlay2 that wedges resume. Image cache therefore does **not** persist
  across an idle stop/resume (cold rebuild).
- **Disk bound.** A plain Docker named volume has no hard size cap. For a real
  multi-tenant quota, back the host docker data-root with an XFS project quota
  (or a fixed-size loopback filesystem). On K8s the `emptyDir.sizeLimit` bounds
  it (eviction is laggy). **Set a quota before exposing this to untrusted
  tenants** — an unbounded `docker build` loop is a disk-DoS.
- **Caches.** The shared per-org pip/npm/bun caches are **disabled** under DinD
  (per-container userns shifting makes a shared cross-session volume unsafe).
  Installs still work, just uncached across sessions.

## v1 limitations

- **Public images only.** Private-registry `docker login` / credential handling
  is deferred.
- **Sessions-only.** One-shot `/v1/execute` does not get docker.
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
    ~885 MiB debug symbols — with `EFBIG`). The disk bound is the
    `/var/lib/docker` volume quota above, not a per-file ceiling. `nofile` is
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
