# Persistent sandbox sessions

Every sandbox run is a **session** (`/v1/sessions/*`) — a long-lived "remote
computer" that survives many operations. One model, one codebase, one runtime
image; the only thing that varies is _when the session is destroyed_:

- **thread run_code** — a per-thread session, idle-stopped (workspace preserved)
  and destroyed on thread delete.
- **external agents** (Claude Code, Cursor) — a per-(org,user) session.
- **workflow steps** (agent AND script) — an ephemeral per-(run,step) session,
  torn down at step end.
- **crawler renders** — an ephemeral render session, destroyed right after the
  render.

Per-org fairness is the governance `sandbox_quota` policy (separate user /
thread / workflow / render budgets); the host ceiling is `SANDBOX_MAX_SESSIONS`.

> The legacy one-shot `POST /v1/execute` route still exists in the spawner but
> has no caller — its `ExecutionBackend` doubles as the boot/shutdown lifecycle,
> so removing it is a separate decouple-lifecycle-from-execute refactor.

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
(`SessionRoutes.adoptExisting`); a periodic reaper (`sweepExpired`) **stops**
sessions past their TTL (registry check) or idle timeout (runnerd `/healthz`
`lastActivityAtMs`).

### Stop vs destroy — the data-preservation contract

The reaper **stops** (`backend.stopSession`), it does not destroy: the
container/Pod is removed to release compute, but the **workspace is preserved**
(host bind-dir on Docker, per-session PVC on K8s). Neither the idle timeout nor
the hard TTL ever deletes data — they only hibernate. The next turn **resumes**
a stopped session by re-creating against the same deterministic `sessionId`,
which re-attaches the same workspace (`createSession`'s `mkdir`/PVC-ensure are
idempotent), so files **and** the per-thread Claude `--resume` conversation
continue (the platform keeps the same incarnation `createdAt`). The only path
that deletes a workspace is the **explicit Destroy** (management page →
`destroySession`); `evictIfBackendGone` evicts a stale registry entry without
touching the workspace. Pinned ("always-on") and live-exec sessions are exempt
from the reaper entirely.

## Secret-management model (tiered — the security invariant)

Secrets entering a sandbox is a graded decision, documented and enforced:

- **Tier 0 — platform-global secrets** (`SANDBOX_TOKEN`, LLM gateway management
  token, SOPS age key, raw provider API keys): **never enter a sandbox**, ever.
- **Tier 1 — proxiable credentials** (LLM provider keys): stay outside. The
  sandbox holds only a session-scoped gateway virtual key (`sk-bf-*`); LLM
  traffic transits the gateway, which attaches the real key. Bought: per-key
  budget, model allowlist, instant revoke, server-side usage metering.
- **Tier 2 — managed-entry credentials** (connector secrets — git tokens,
  DB passwords, third-party API keys — that can't be transparently proxied):
  enter the sandbox, but only through one managed pipeline — explicit
  per-turn grant (default empty; the turn's equipped connectors ∩ the
  broker's allowlist) → broker fetch (never baked into env/image/PodSpec)
  → audited (`sandboxCredentialAccess`) → gone with the exec. The broker
  injects git creds into the exec's PER-EXEC env overlay, never the
  session env store (the `tale-git-credential` helper reads `GITHUB_TOKEN`
  per git operation): the agent session is per-user and long-lived while
  a grant is per-turn, so the overlay's lifetime IS the revocation — a
  later ungranted turn never inherits the token, and nothing survives a
  container recreation. True per-operation broker fetch (with immediate
  per-op revocation) is a planned follow-up.

Beside the credential helper, the broker also provisions the session
owner's git **author identity** (`user.name`/`user.email`, injected as
`GIT_CONFIG_*` env — `session_credentials.ts`'s `buildGitConfigEnv`). It is
non-secret metadata, not a Tier-2 grant, so — unlike the helper above — it
is never gated on a git credential grant: it runs whenever the session
resolves to a real platform user, so a fresh container's `git commit` has
an author without any in-session `git config`. A synthetic/system-owned
session (automation, workflow) or an owner with a blank name/email
resolves to no injection rather than a placeholder identity.

## Resource profiles

`default` mirrors the one-shot caps (uid 65534). `agent` (uid 10001 — a real
passwd entry, so git/ssh work and Claude Code's `bypassPermissions` is allowed
since the user is non-root): 2 CPU, 4 GiB, 512 pids, no cumulative-CPU ulimit
(would kill a long-lived daemon), 512 MB `/dev/shm` (Chromium/Playwright),
512 MB `/tmp`. All hardening is preserved: read-only root, `cap-drop=ALL`,
`no-new-privileges`, apparmor/seccomp RuntimeDefault.

`HOME=/user/.runtime/home` lives on the persistent workspace, so agent state
(`~/.claude`, `~/.cursor`, `~/.gitconfig`) survives every exec and an
in-place container restart — this _is_ the session-persistence mechanism.

`TMPDIR=/user/.runtime/tmp` also lives on the workspace (disk-backed), not the
`/tmp` tmpfs: pip stages a whole target install set in `$TMPDIR`, and the tmpfs
is small and memory-backed (charged to the container's memory cgroup), so any
install past the tmpfs size would die with ENOSPC. The entrypoint wipes the dir
at container (re)start — no exec is live then — preserving the old /tmp
lifecycle. `/tmp` remains for small control files (redsocks.conf, X11 socket).

## Kubernetes specifics

One long-lived Pod per session (`buildSessionPod`), `restartPolicy: Always`
(a runner crash restarts in place against the surviving workspace; runnerd
re-boots idempotently → brief `degraded` blip, session intact). Single
`runner` container — staging/harvest are runnerd's job, so there is **no** stage
initContainer / harvest sidecar. `automountServiceAccountToken: false`,
readiness probe on the unauthenticated `/readyz`, per-session Secret
(`<pod>-spec`) carrying the runnerd token + seed env via `envFrom`.

The workspace is a **per-session PVC** (`<pod>-ws`, `ReadWriteOnce`, sized by
`SANDBOX_K8S_WORKSPACE_SIZE_LIMIT`, storage class from
`SANDBOX_K8S_CACHE_STORAGECLASS`), `ensure`d before the Pod (read-before-create,
409-tolerant — same pattern as the per-org cache PVCs). It is the durable home
of `/user` across stop→resume: `stopSession` deletes the Pod + Secret but
**keeps** the PVC; only `destroySession` deletes it. **RWO caveat:** an RWO PVC
binds to a node, so on a multi-node cluster a resume Pod must be schedulable
where the volume can attach — operators needing cross-node resume must supply a
storage class whose volumes re-bind (e.g. a networked/CSI RWO backend), else a
resume can stall pending volume attach. Orphan PVCs (a spawner crash between Pod
delete and PVC delete during an explicit destroy) are rare under the
delete-only-on-Destroy model; a label-selector sweep (`tale.sandbox-session-ws`)
is a follow-up if they accumulate.

### RBAC delta (vs the one-shot backend)

The session backend needs, in the sandbox namespace, on `pods` and `secrets`:
`get`, `list`, `create`, `delete`; and on `persistentvolumeclaims`: `get`,
`create`, `delete` (the per-session workspace PVC). **No `pods/exec`, ever.**

### NetworkPolicy

- Session Pods (`tale.sandbox/role: session`): egress to the egress proxy, the
  LLM gateway Service (`:8080`), and DNS only — same shape as the one-shot
  runtime egress allowance plus the gateway.
- Ingress to session Pods on `:8200` (runnerd) is allowed **from the spawner
  Deployment only**.

## Testing

- Unit: runnerd (exec stream / timeout / cancel / env deny-list / file ops /
  attach replay), `docker-session-args` + `k8s-session-pod-spec` snapshots,
  the session route layer against a fake runnerd, the agent adapters.
- Image conformance (no LLM, no cluster): `services/platform/tests/integration/container-sandbox-runtime-test.ts`.
- E2E on kind (needs a cluster): create → exec → kill-container-restart →
  idle-reap-stop → resume (workspace + PVC preserved) → explicit destroy (PVC
  deleted); cross-replica exec/destroy. (Pending — requires a kind cluster + the
  built agent image.)
- Live agent smoke (secret-gated, needs real provider creds via the LLM gateway):
  one real `claude -p` + `agent -p` turn end-to-end. (Pending.)
