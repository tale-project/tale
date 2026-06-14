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

You need two things: select a supported tier + enable the flag, **and** install
the matching runtime on the host/cluster.

### Configuration

Either env (on the `sandbox` service):

```
SANDBOX_RUNTIME=sysbox
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
- **Egress.** Before starting the inner daemon, the entrypoint installs an
  iptables fence in the container's network namespace that **rejects** inner
  containers reaching IMDS (`169.254.169.254`), link-local, and RFC1918 — which
  on the sandbox bridge includes the LLM gateway, the egress proxy, and other
  tenants. Intra-`docker compose` traffic (the controlled inner pool) is
  exempted so service-to-service works.
- **Registry pulls** go through the egress proxy (the inner `dockerd` inherits
  `HTTP(S)_PROXY`). Inner containers that need outbound network must propagate
  the proxy themselves (compose `environment:` / build `args:`
  `HTTP_PROXY`/`HTTPS_PROXY`). The proxy is HTTPS-CONNECT (`:443`) only; if you
  run an allowlist (`SANDBOX_EGRESS_ALLOWLIST`), include your registry + auth
  hosts.
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
  (cpu/memory/pids). Usage attribution stays at session granularity.
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
