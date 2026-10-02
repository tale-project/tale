# Persistent sandbox sessions

Every sandbox run is a **session** (`/v1/sessions/*`) — a long-lived "remote
computer" that survives many operations. One model, one codebase, one runtime
image; the only thing that varies is _when the session is destroyed_:

- **project agents** — a standing per-agent session (and one per member who
  starts the agent's runs) that persists across task runs (idle-stopped,
  workspace preserved) until the agent or the member is removed, or nobody
  uses it for the organization's `sandbox_workspaces` window (30 days by
  default) — see [Workspace cleanup](#workspace-cleanup).
- **workflow runs** — one session shared by the run's agent AND script nodes,
  reclaimed after the run ends and no execution remains.
- **crawler renders** — an ephemeral render session, destroyed right after the
  render.

Per-org fairness is the governance `sandbox_quota` policy (separate project-agent,
workflow and render budgets, default 2 each). Their total is derived, and saving
the policy requires that total to fit the current deployment capacity,
`SANDBOX_MAX_SESSIONS` (sized from host memory on a local Docker host when
unset, at least 8; 8 elsewhere), plus the slots of the organization's
connected [devices](devices.md). There is no independent organization runtime
ceiling. Concurrent executions of the same workflow each own a separate session;
agent and script nodes within one execution share that session.

> The legacy one-shot `POST /v1/execute` route and the runtime image's one-shot
> language lane are gone; `HostBackend` owns the
> host lifecycle (boot/shutdown, `/health`, the legacy-orphan sweep).

## Architecture

A session is a long-lived container (Docker) / Pod (K8s) running **runnerd**, a
small control daemon (`services/sandbox-runtime/daemon`, bundled to a single
`runnerd.mjs` and run by the image's Node 24), under the image's `tini` init as
PID 1 on every dispatch path — a long-lived container needs a real reaper, since
cancelled exec trees leave orphans that node (which
never `wait()`s children it did not spawn) would otherwise accumulate as zombies
against `pids-limit`. The spawner proxies every in-session operation to runnerd
over plain HTTP on `:8200`:

- Docker: container DNS name `tale-sbx-ses-<id>` on `tale-sandbox-net`; an id
  that would outgrow the 63-character DNS label (a member's workspace session)
  is replaced by the first 16 hex digits of its SHA-1, as the K8s backend does.
- K8s: the Pod IP (read from `status.podIP`).

**No `kubectl exec`/attach anywhere** — runnerd is reached by ordinary HTTP, so
the exec-free K8s constraint holds. runnerd auth is the per-session token
`HMAC-SHA256(SANDBOX_TOKEN, "runnerd-v1:" + sessionId)` in the
`x-tale-runnerd-token` header — derivable by any spawner replica, stored
nowhere. `SANDBOX_TOKEN` is required (the spawner refuses to boot without it —
`loadConfig` fails closed), so every session carries a real token and runnerd
always verifies; there is no unsigned mode.

The in-memory session registry is a **cache, not the source of truth**: the
backend objects (container/Pod labels + annotations) plus runnerd's activity
clock are authoritative. On boot the spawner re-adopts running sessions
(`SessionRoutes.adoptExisting`); a maintenance pass every minute
(`SessionRoutes.maintain`: adoption, then the reaper `sweepExpired`; a pass
still running is joined, never stacked) **stops**:

- sessions past their TTL (registry check) or idle timeout (runnerd `/healthz`
  `lastActivityAtMs`);
- a **released** session — one the platform released after its turn or run
  settled, with no work holding it — once it has been idle for
  `SANDBOX_SESSION_RELEASED_IDLE_MS` (5 minutes by default), through runnerd's
  atomic claim, so a turn that acquires it meanwhile keeps it. A resume costs
  well under a second on a warm image, so holding the slot and the memory of an
  idle session for the full idle window bought little. Agent sessions with
  Docker inside keep the full window: their resume starts the inner daemon on
  an empty image store;
- a running session whose runnerd has not answered five sweeps in a row (a
  wedged daemon used to hold its slot and limits until the 24 h TTL);
- compute whose process ended for good — a container exited or dead after a
  host reboot or an OOM-killed init, a Pod Failed or evicted — which adoption
  never registers and which used to stay (with, on Docker, its inner image
  volume) until a resume or a destroy.

Every such stop is fenced to the incarnation the registry or listing
describes, and keeps the workspace. The pass probes at most eight daemons at a
time, so a few hung ones bound it rather than the sum of every probe.

### Capacity and idle reclamation

The signed `GET /v1/limits` route exposes the configured `maxSessions`
independently of runtime inventory availability. Platform reads it again on each
quota save; forged client totals cannot bypass the sum check. Runtime occupancy
still counts released containers that remain warm, so it can exceed the sum of
an organization's active workload allocations.

The signed session activity routes tie idle eligibility to the current
allocation: `POST /v1/sessions/:id/acquire` marks new work and advances the
generation; `GET /v1/sessions/:id/release` reads a release ticket; and
`POST /v1/sessions/:id/release` conditionally releases that generation. Platform
captures the ticket before freeing the allocation and publishes the release job
only when that transaction commits. The job rechecks the allocation and active
owners before release, while the generation check rejects delayed completions
that belong to work before a reacquire.

When admission reaches deployment capacity, runnerd can atomically freeze a
released, unpinned session only if no request, file operation, staging operation
or exec is in flight. The candidates are tried idle-longest first, and each
create at capacity claims a session of its own: a burst of creates meeting a
fleet of released sessions is admitted at once instead of one per retry. The freeze blocks new work while the spawner removes
compute through `stopSession`, preserving the workspace. Busy, unresponsive and
older daemons without this protocol are ineligible. The reclaim runs outside
the admission lock — creates that still have room never queue behind a probe
or a backend stop — and a daemon that fails its probe is skipped for a short
back-off instead of costing every create at capacity a health timeout. A stop
failure retains occupied capacity and the frozen gate until a retry succeeds;
it does not unfreeze work under a pending stop. Once runnerd has acknowledged
the claim, the retry (the next sweep, or the next acquire for that session,
which then answers not-found so the caller recreates at once) removes the
compute without another probe — a container whose daemon has since died is
still ours to remove. A replacement spawner can resume that stop after
restart. Docker removal is fenced by container identity; Kubernetes removal is
fenced by Pod and Secret UIDs (the Secret read through the `list` verb the
Role grants) and waits for the original Pod to disappear before admitting a
replacement. A different incarnation found under the name is never counted as
freed. An acquire for a session whose create is still in flight waits for
that create (bounded) rather than answering a false not-found.

Where the spawner can read the Docker host's memory (the local socket, the
same kernel and total as the daemon reports), admission also holds every
create to the host's free memory: with each create still starting counted at
its planned working set (agent 512 MiB, with Docker inside 1.5 GiB, crawler
render 256 MiB), the host must keep `SANDBOX_MIN_FREE_MEMORY` free (a tenth of
it, at least 1 GiB). Short of it, the create reclaims a released idle session
like one at capacity, then answers 429 `host_memory` (`retry-after: 15`). The
decision is taken under the admission lock from a reading at most a second
old, so a burst sees each create admitted before it. Unknown memory never
refuses a create.

Admission is serialized by the single Docker spawner. Kubernetes replicas
enforce the shared namespace count on a best-effort basis; use ResourceQuota
for hard namespace resource bounds.

### Stop vs destroy — the data-preservation contract

The reaper **stops** (`backend.stopSession`), it does not destroy: the
container/Pod is removed to release compute, but the **workspace is preserved**
(host bind-dir on Docker, per-session PVC on K8s). Neither the idle timeout nor
the hard TTL ever deletes data — they only hibernate. The next turn **resumes**
a stopped session by re-creating against the same deterministic `sessionId`,
which re-attaches the same workspace (`createSession`'s `mkdir`/PVC-ensure are
idempotent), so files **and** the harness `--resume` conversation
continue (the platform keeps the same incarnation `createdAt`). Only
`destroySession` deletes a workspace — reached by the **explicit Destroy**
(management page) and by the platform's [workspace cleanup](#workspace-cleanup);
`evictIfBackendGone` evicts a stale registry entry without touching the
workspace. Pinned ("always-on") and live-exec sessions are exempt from the
reaper entirely, except that compute which has already ended is removed (the
pin's own reconcile recreates a pinned session).

A destroy does not wait for the workspace's data to go. On Docker, once the
container is confirmed gone, the `ses-<id>` dir is renamed into
`<root>/.trash/` under a name of its own (`ses-<id>.<uuid>`) — one directory
entry changed on the same filesystem, however many files the workspace holds —
and the destroy answers; a background pass then deletes the trash, one entry
after another. So a workspace of tens of GB in a million files answers as fast
as an empty one (the platform gives a destroy 30 s), the id is free for a fresh
workspace at once, and a repeated destroy finds nothing (`destroyed: false`).
The disk space comes back when the background deletion finishes; one that took
a second or more is logged (`[sandbox.trash] removed …`). What a restart or a
crash cut short goes at the next start (the boot sweep), and an entry that
could not be removed is logged and retried by the next pass and the
five-minute sweep. `.trash/` is a dot-dir: the workspace inventory, the
host-dir sweep and the resume resolver never take it for a workspace. Where the
rename cannot happen (another filesystem, a disk too full for the directory
entry), the workspace is deleted in place before the answer, as it was before
the trash, and a failure there answers 502. On Kubernetes the PVC delete
already hands the volume to its provisioner.

### Workspace cleanup

A preserved workspace is only worth keeping while something can come back to
it. The platform owns that decision — it knows who owns each workspace — and
the spawner reports what it physically holds and refuses what is in use. The
platform's side (`services/platform/backend/domains/sandbox/workspace-cleanup.ts`)
deletes a workspace:

- when its owner is deleted: a project agent (or its project), a member who
  leaves the organization (their workspaces with every agent), a user's GDPR
  erasure, a whole organization — through jobs queued in the deleting
  transaction, and the hourly sweep after them (a workspace of runs a
  departed person started is found through those runs);
- when nobody used a project agent's workspace for the organization's
  `sandbox_workspaces` window (a governance policy, 30 days by default;
  pinned workspaces are never deleted for being unused, and an unpin starts
  the window over) — and never before a
  full window has passed since that rule took effect (the upgrade that
  brought it, turning it on, a shorter window; `app.sandbox_workspace_retention`),
  so nobody loses a workspace they had no window to use or pin;
- when nothing owns it any more — an ended run whose reclaim never came, a
  cut-off render, a workspace of an organization the platform deleted —
  found through the inventory. Of the workspaces no row names, only those
  attributable to the deployment go: a render's, or one whose recorded
  organization the deployment holds (unless its project agent still exists)
  or deleted. A spawner or namespace can also hold another deployment's
  workspaces, which no row names either; those, and the ones with no
  recorded organization, are left alone.

An hourly sweep (`sandbox.workspace_gc`) is the backstop for all of it. A legal
hold keeps everything it covers. Every decision is taken again under the
organization's admission lock right before the platform ends the session's
live incarnation, so a turn that resumed the workspace in between keeps it, and
a turn after that starts a fresh incarnation.

The spawner's part:

- `GET /v1/workspaces` — every workspace the backend holds (Docker: the
  `ses-<id>` dirs in both layouts; Kubernetes: the `tale.sandbox-session-ws`
  PVCs), with when it last changed, whether compute exists for it, its pin and
  its organization when recorded, plus the organizations holding resources
  beyond their workspaces (Docker build helpers and package caches). The
  organization is the container's or Pod's label, else the workspace's own
  record: on Docker `<root>/.owners/<id>.org`, written at create beside the
  pin markers and outside the workspace, and removed with it; on Kubernetes
  the PVC's `tale.dev/organization-id` annotation. A workspace created before
  either existed names none. Leaving a workspace out is always safe: the
  platform only deletes what the list names and its records disown. A list
  that cannot be read is a 503.
- `DELETE /v1/sessions/:id?if_idle=1&if_stopped=1` — the cleanup's destroy:
  `if_stopped` refuses (`{busy:true}`) while any compute runs under the id or a
  create of it is in flight; `if_idle` rides along so a spawner or device that
  predates `if_stopped` still refuses a live exec. Destroys of one id run one
  after another, and a create of an id waits for a destroy of it under way —
  up to two minutes; past that it answers 429 busy (`retry-after`), so a
  destroy wedged on its filesystem never holds the create and its capacity
  slot for ever.
- `DELETE /v1/organizations/:id` — for an organization the platform deleted:
  destroys every session the backend still holds for it (containers/Pods with
  their workspaces) and every stopped workspace attributed to it, then its
  build helpers, their network and volumes, and its package caches (Docker;
  Kubernetes keeps nothing per organization beyond PVCs). A workspace list
  that cannot be read leaves the stopped ones to the platform, which names
  every workspace its rows knew. 409 while a create of the organization is in
  flight, 502 on a failure; idempotent.

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

`default` uses uid 65534 with the hardened code/render profile. `agent` uses
uid 10001, a named non-root account for git/ssh and coding CLIs. Its defaults
are 2 CPU, 4 GiB memory (8 GiB with DinD), 512 pids, 512 MB `/dev/shm`, and
512 MB `/tmp`; the `SANDBOX_AGENT_*` settings override these limits.
Non-DinD sessions keep a read-only root and drop capabilities. DinD changes
the container security and process limits according to the selected runtime
tier; headless Chromium remains available on demand in either profile.

`HOME=/agent/.runtime/home` lives on the persistent workspace, so agent state
(`~/.claude`, `~/.cursor`, `~/.gitconfig`) survives every exec and an
in-place container restart — this _is_ the session-persistence mechanism.

`TMPDIR=/agent/.runtime/tmp` also lives on the workspace (disk-backed), not the
`/tmp` tmpfs: pip stages a whole target install set in `$TMPDIR`, and the tmpfs
is small and memory-backed (charged to the container's memory cgroup), so any
install past the tmpfs size would die with ENOSPC. The entrypoint wipes the dir
at container (re)start — no exec is live then — preserving the old /tmp
lifecycle. `/tmp` remains for small control files such as redsocks.conf.

## Kubernetes specifics

One long-lived Pod per session (`buildSessionPod`), `restartPolicy: Always`
(a runner crash restarts in place against the surviving workspace; runnerd
re-boots idempotently → brief `degraded` blip, session intact). Single
`runner` container — staging/harvest are runnerd's job, so there is **no** stage
initContainer / harvest sidecar. `automountServiceAccountToken: false`,
readiness probe on the unauthenticated `/readyz`, per-session Secret
(`<pod>-spec`) carrying the runnerd token + seed env via `envFrom`.

A crawler render (the `default` profile) is created for one batch and
destroyed after it, so its workspace is a sized `emptyDir`; an agent
session's workspace is a **per-session PVC** (`<pod>-ws`, `ReadWriteOnce`, sized by
`SANDBOX_K8S_WORKSPACE_SIZE_LIMIT`, storage class from
`SANDBOX_K8S_CACHE_STORAGECLASS`), `ensure`d before the Pod (read-before-create,
409-tolerant so a concurrent create on a peer replica wins cleanly). It is the durable home
of `/agent` across stop→resume: `stopSession` deletes the Pod + Secret but
**keeps** the PVC; only `destroySession` deletes it. **RWO caveat:** an RWO PVC
binds to a node, so on a multi-node cluster a resume Pod must be schedulable
where the volume can attach — operators needing cross-node resume must supply a
storage class whose volumes re-bind (e.g. a networked/CSI RWO backend), else a
resume can stall pending volume attach. A PVC records its session and, since
the workspace cleanup, its organization (`tale.dev/organization-id`); the
cleanup's inventory lists PVCs by the `tale.sandbox-session-ws` label, so one
whose session nothing owns any more — a spawner crash between Pod delete and
PVC delete, a deleted organization — is deleted like any other orphaned
workspace.

### RBAC

The session backend needs, in the sandbox namespace, on `pods`: `create`,
`get`, `list`, `delete`, `patch`; on `secrets`: `create`, `delete`, `list`; and
on `persistentvolumeclaims`: `get`, `list`, `create`, `delete` (the per-session
workspace PVC; `list` backs the workspace inventory — without it the inventory
answers 503 and the platform skips its orphan pass). **No `pods/exec`, ever.** The full Role, including the
NetworkPolicy verbs, is in [kubernetes.md](kubernetes.md#rbac-namespaced-role--no-cluster-scope-no-podsexec).

### NetworkPolicy

- Session Pods (`tale.sandbox/role: session`): egress to the egress proxy, the
  LLM gateway Service (`:8080`), and DNS only.
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
