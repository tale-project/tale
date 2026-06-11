# Persistent sandbox sessions

The sandbox service runs in two modes from one codebase + one runtime image:

- **One-shot** (`POST /v1/execute`) — an ephemeral container/Pod per call. Unchanged.
- **Sessions** (`/v1/sessions/*`) — a long-lived "remote computer" that survives
  many operations, for coding agents (Claude Code, OpenCode) and general
  interactive work.

## Architecture

A session is a long-lived container (Docker) / Pod (K8s) whose PID 1 is
**runnerd**, a small control daemon (`services/sandbox-runtime/daemon`, bundled
to a single `runnerd.mjs` and run by the image's Node 24). The spawner proxies
every in-session operation to runnerd over plain HTTP on `:8200`:

- Docker: container DNS name `tale-sbx-ses-<id>` on `tale-sandbox-net`.
- K8s: the Pod IP (read from `status.podIP`).

**No `kubectl exec`/attach anywhere** — runnerd is reached by ordinary HTTP, so
the exec-free K8s constraint holds. runnerd auth is the per-session token
`HMAC-SHA256(SANDBOX_TOKEN, "runnerd-v1:" + sessionId)` in the
`x-tale-runnerd-token` header — derivable by any spawner replica, stored
nowhere. Unsigned dev mode (`SANDBOX_TOKEN` unset) uses an empty token and
runnerd skips the check, mirroring the spawner's own opt-in HMAC policy.

The in-memory session registry is a **cache, not the source of truth**: the
backend objects (container/Pod labels + annotations) plus runnerd's activity
clock are authoritative. On boot the spawner re-adopts running sessions
(`SessionRoutes.adoptExisting`); a periodic reaper (`sweepExpired`) destroys
sessions past their TTL (registry check) or idle timeout (runnerd `/healthz`
`lastActivityAtMs`).

## Secret-management model (tiered — the security invariant)

Secrets entering a sandbox is a graded decision, documented and enforced:

- **Tier 0 — platform-global secrets** (`SANDBOX_TOKEN`, Bifrost management
  token, SOPS age key, raw provider API keys): **never enter a sandbox**, ever.
- **Tier 1 — proxiable credentials** (LLM provider keys): stay outside. The
  sandbox holds only a session-scoped Bifrost virtual key (`sk-bf-*`); LLM
  traffic transits the gateway, which attaches the real key. Bought: per-key
  budget, model allowlist, instant revoke, server-side usage metering.
- **Tier 2 — managed-entry credentials** (integration secrets — git tokens,
  DB passwords, third-party API keys — that can't be transparently proxied):
  enter the sandbox, but only through one managed pipeline — explicit
  per-session grant (default empty) → broker fetch (never baked into
  env/image/PodSpec) → audited (`sandboxCredentialAccess`) → revoked on
  destroy (git creds fetched per-operation, so revocation is immediate).

## Resource profiles

`default` mirrors the one-shot caps (uid 65534). `agent` (uid 10001 — a real
passwd entry, so git/ssh work and Claude Code's `bypassPermissions` is allowed
since the user is non-root): 2 CPU, 4 GiB, 512 pids, no cumulative-CPU ulimit
(would kill a long-lived daemon), 512 MB `/dev/shm` (Chromium/Playwright),
512 MB `/tmp`. All hardening is preserved: read-only root, `cap-drop=ALL`,
`no-new-privileges`, apparmor/seccomp RuntimeDefault.

`HOME=/workspace/.home` lives on the persistent workspace, so agent state
(`~/.claude`, `~/.config/opencode`, `~/.gitconfig`) survives every exec and an
in-place container restart — this _is_ the session-persistence mechanism.

## Kubernetes specifics

One long-lived Pod per session (`buildSessionPod`), `restartPolicy: Always`
(a runner crash restarts in place against the surviving `emptyDir` workspace;
runnerd re-boots idempotently → brief `degraded` blip, session intact). Single
`runner` container — staging/harvest are runnerd's job, so there is **no** stage
initContainer / harvest sidecar. `automountServiceAccountToken: false`,
readiness probe on the unauthenticated `/readyz`, per-session Secret
(`<pod>-spec`) carrying the runnerd token + seed env via `envFrom`.

PVC is intentionally **not** used for the session workspace: bare Pods don't
reschedule, so PVC durability buys nothing without a controller. v1 uses
`emptyDir` (8 Gi `sizeLimit`) with documented node-failure loss semantics; a
StatefulSet-style controller is the v2 path if node-failure survival is needed.

### RBAC delta (vs the one-shot backend)

The session backend needs, in the sandbox namespace, on `pods` and `secrets`:
`get`, `list`, `create`, `delete`. **No `pods/exec`, ever.**

### NetworkPolicy

- Session Pods (`tale.sandbox/role: session`): egress to the egress proxy, the
  Bifrost gateway Service (`:8080`), and DNS only — same shape as the one-shot
  runtime egress allowance plus the gateway.
- Ingress to session Pods on `:8200` (runnerd) is allowed **from the spawner
  Deployment only**.

## Testing

- Unit: runnerd (exec stream / timeout / cancel / env deny-list / file ops /
  attach replay), `docker-session-args` + `k8s-session-pod-spec` snapshots,
  the session route layer against a fake runnerd, the agent adapters.
- Image conformance (no LLM, no cluster): `tests/container-sandbox-runtime-test.sh`.
- E2E on kind (needs a cluster): create → exec → kill-container-restart →
  idle-reap → destroy; cross-replica exec/destroy. (Pending — requires a kind
  cluster + the built agent image.)
- Live agent smoke (secret-gated, needs real provider creds via Bifrost):
  one real `claude -p` + `opencode run` turn end-to-end. (Pending.)
