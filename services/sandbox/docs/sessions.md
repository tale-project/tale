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
PID 1 on every dispatch path — a long-lived container needs a real reaper: what
an exec orphans goes to the exec's subreaper shim (below), but what a shim
killed outright leaves, and what the entrypoint's own daemons orphan, reaches
PID 1, where node (which never `wait()`s children it did not spawn) would let
it accumulate as zombies against `pids-limit`. The spawner proxies every in-session operation to runnerd
over plain HTTP on `:8200`:

- Docker: container DNS name `tale-sbx-ses-<id>` on `tale-sandbox-net`; an id
  that would outgrow the 63-character DNS label (a member's workspace session)
  is replaced by the first 16 hex digits of its SHA-1, as the K8s backend does.
- K8s: the Pod IP (read from `status.podIP`).

**An exec's leftover processes are ended.** runnerd starts each exec under
`tale-exec-shim` (`services/sandbox-runtime/daemon/exec-shim/`), a small shim
that runs the command in a process group of its own and is a child subreaper
(`PR_SET_CHILD_SUBREAPER`): every process the command's tree orphans is
reparented to the shim, not to PID 1, so whatever the exec starts stays the
shim's descendant — a server that double-forked into a session of its own
and replaced its environment included. The shim tells runnerd on a status
pipe the command's pid, how it ended, or why it could not be run; it keeps
none of the command's output pipes and exits, with the command's status, once
nothing below it runs. runnerd also puts the exec id in the environment
(`TALE_EXEC_ID`), which every descendant inherits. When the exec's command
exits, runnerd sends SIGTERM to what it left running — the group as a whole,
and on its own each process below the shim, or carrying the id, that moved to
a group or session of its own (such as a browser its driver started detached)
— then SIGKILL five seconds later. While another exec of the session still runs, the
leftovers wait: that exec may be using what the earlier one started (a dev
server, a build daemon), so they end when the session's last running exec
ends; meanwhile they keep their output pipes, whose output runnerd reads and
drops. A cancel or the deadline ends the exec's processes at once, what it
left waiting included, and the SIGKILL reaches its group while its own
process still runs even if no process there shows the id. A
backgrounded server, a `nohup` worker or a browser therefore no longer runs on
in a session that reads idle until the container stops. Each process gets one
SIGTERM, so a second signal never cuts short the cleanup the first one started.
A group's number can be reused once the group is gone, so a signal that comes
after the exec's end reaches the group only while the group is provably still
the exec's: a process carrying the id is in it, or a process runnerd recorded
in it (pid and start time, from `/proc/<pid>/stat`) still is. The record is
taken when the exec ends while its leftovers wait, and by each SIGTERM round
for the SIGKILL that follows, so a leftover that stayed in the group without
the id (started with `env -i`, or a server that rewrote its environment) is
ended too.
Out of reach: the daemons the entrypoint starts (redsocks, the inner dockerd),
the containers an exec runs under the inner dockerd, and — where an exec runs
without the shim (a kernel that refuses the subreaper, which runnerd logs
once; a development host that is not Linux) — a process that both left the
exec's group and replaced its environment. runnerd's startup line names the
shim it uses (`execShim=`). On SIGTERM, runnerd passes the signal on to every
live exec, and to what exited execs left waiting, before it exits.

Reading another process's environment waits on that process's memory lock,
which a process stuck under memory pressure can hold for minutes. While every
exec a round covers still has its shim, the round reads `/proc/<pid>/stat`
alone — parent, group and start time — and no environment. Otherwise runnerd
signals a group it knows is the exec's (a live exec, one whose own process
just exited) before it reads the process table, a scan answers with what it
read after two seconds, and a process whose read did not come back is skipped
until the read returns or the process is gone. While such a read is still out,
runnerd ends itself by SIGKILL when it exits: `process.exit` would wait for
the read. A cancel that comes before the shim has named the command's group
waits for it — the shim does so as soon as it has forked — so the group still
gets its signal as a whole.

**A rotation keeps what the turn started.** A steer's restart cancels a
running turn and continues the conversation in a new exec over the same
workspace, so the platform sends that cancel as a rotation:
`POST /v1/sessions/:id/exec/:execId/cancel?leftovers=keep`, which the spawner
forwards to runnerd's `POST /execs/:id/cancel?leftovers=keep`. runnerd then
ends only the exec's own process group (SIGTERM, then SIGKILL five seconds
later while its own process still runs) and holds what it left outside the
group, such as a dev server a harness's tool call started in a session of its
own, for the exec that takes over. The hold lifts when an exec started after
the cancel ends; the leftovers then end with the session's last running exec,
as above, or when runnerd stops. A hold that sees no successor within ten
minutes (a restart whose new exec never started) lifts too, and with no exec
running its leftovers end at once. A later cancel of the handed-over exec (the
platform's superseded drive still reaps the exec it no longer owns) ends none
of what it holds; a person's Stop goes to the exec that took over, and its
end ends them. A plain cancel ends everything; a spawner or runnerd that
predates the flag ignores it and does the same.

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
(`SessionRoutes.adoptExisting`), resolving at most eight endpoints at once so
Kubernetes recovery does not wait for each Pod read in turn. If draining begins
during recovery, no further peer session is adopted, including one whose
endpoint read was already in flight. A maintenance pass every minute
(`SessionRoutes.maintain`: adoption, then the reaper `sweepExpired`; a pass
still running is joined, never stacked) **stops**:

- sessions past their TTL (registry check) or idle timeout (runnerd `/healthz`
  `lastActivityAtMs`). Runtimes advertising `activity.idleReclaim` atomically
  check the observed generation and activity cutoff before freezing the
  session, so an acquire or completed write after the probe prevents a stale
  stop. Older runtimes retain the previous expiry checks during a mixed-image
  rollout;
- a **released** session — one the platform released after its turn or run
  settled, with no work holding it — once it has been idle for
  `SANDBOX_SESSION_RELEASED_IDLE_MS` (5 minutes by default), through runnerd's
  atomic claim, so a turn that acquires it meanwhile keeps it. A resume costs
  well under a second on a warm image, so holding the slot and the memory of an
  idle session for the full idle window bought little. Agent sessions with
  Docker inside keep the full window: their resume starts the inner daemon on
  an empty image store;
- a running session whose runnerd has not answered five sweeps in a row (a
  wedged daemon used to hold its slot and limits until the 24 h TTL); a sweep
  that cannot probe it — pinned, or an exec running through this spawner —
  starts the count over;
- compute whose process ended for good — a container exited or dead after a
  host reboot or an OOM-killed init, a Pod Failed or evicted — which adoption
  never registers and which used to stay (with, on Docker, its inner image
  volume) until a resume or a destroy. Their removal runs beside the API,
  eight at a time: after a host reboot every session container has ended.
  A create of an id whose ended compute is still being removed — the
  platform resuming it at once — waits for that removal, up to 30 seconds
  (else it answers 429 busy and the caller retries): past the fenced
  container removal, the removal's steps are keyed by the session's name
  (the inner image volume, the pin marker) and would otherwise remove what
  the new container uses. The removal
  belongs to the ended incarnation: it never holds up an acquire of a
  session registered under the id, nor counts as that session's stop.

Every such stop is fenced to the incarnation the registry or listing
describes, and keeps the workspace. The pass probes at most eight daemons at a
time, so a few hung ones bound it rather than the sum of every probe.

Exec output consumers have an 8 MiB pending-write ceiling. When a reader
falls behind, runnerd disconnects it and releases its socket, buffered writes
and request activity. Attach replay observes socket backpressure directly and
disconnects a reader that has not drained for two seconds. Other readers and
the command continue under the existing exec deadline. A dropped consumer does
not keep an idle session busy after the command ends.

Reconnect through `/execs/:id/attach?sinceSeq=<last-seen-seq>`. The protocol
is retained in a disk-backed spool, limited to **64 MiB of unacknowledged
encoded NDJSON per exec** and **256 MiB of physical replay and checkpoint
storage per session**, including files held open by readers. At most four
execs run at once and 16 exec records are retained. Completed spools are
evicted first under the shared budget. An active writer that exhausts its
budget ends with `OUTPUT_LIMIT`; unavailable or evicted history reports
`REPLAY_UNAVAILABLE`. The 256 KiB diagnostic ring is never substituted for
missing protocol history.

A checkpoint is durably written before its acknowledged prefix is pruned,
so a run can produce more than 64 MiB over its lifetime while the consumer
keeps acknowledging progress. A `gap` event identifies any pruned sequence
interval; consumers restore the durable checkpoint before continuing. Spool
segments and checkpoints live under the runtime-owned `TMPDIR`; normal
disposal removes them and startup clears that directory after a crash. A
runtime restart loses execs and checkpoints, and never clears user files
elsewhere in the persistent workspace.

An attach sends `replay-start` before retained history and `replay-complete`
with `throughSeq` after delivering the
historical prefix that existed when attachment began. Clients must reconstruct
protocol state through that boundary before treating a historical turn result
as completion; a process `exit` is authoritative independently. Older runtimes
omit these markers. Consumers retain their legacy completion behavior only
while replay sequence continuity is verified; an observed gap fails the replay
rather than treating a suffix as complete history.

The initial exec consumer releases its callback and HTTP objects on disconnect.
Body intake drops its raw upload buffers after parsing, and completed commands
release request and consumer data even when background descendants await a
sibling's completion. Deferred process cleanup keeps only ownership and
liveness information, separate from the bounded replay history.

Held-open stdin accepts a whole line only while its pending writes plus that
line fit within 8 MiB. A full queue returns the existing `WRITE_FAILED` reason
without enqueuing any of that line; once the child drains its pipe, writes may
resume. This bounds memory when a command stops reading stdin. Device tunnel
streams also remove caller abort listeners on completion, reset or disconnect.

The platform keeps bounded display projections separately from exact terminal
answers. A terminal without its own final text uses the complete text/delta
fallback under the existing 8 Mi-character answer limit, never the display tail.
Parser usage/tool ledgers refuse more than 16,384 unique IDs, 4,096 characters
per ID, or 1,048,576 retained ID characters instead of evicting deduplication facts.
Malformed base64 output is a protocol failure; legacy text-only streams remain
supported. Session gateway provisioning hands its verified provider key IDs to
its own mint, avoiding a second lookup while each new session rechecks credentials.

### Staged inputs and output reads

`POST /files/stage` accepts the existing `files` list: a destination `path`
and either `url` or `contentBase64`. Downloads stream to a temporary file,
with a 100 MiB cap per file and one 25-second deadline for the whole batch,
including cache verification and reconciliation. They atomically replace the
destination only after success, preserving its existing executable permissions. Inline files remain capped at 1 MiB. Cancelled,
failed and oversized transfers leave the previous destination intact and
remove their temporary file. Parent symlinks cannot redirect staging outside
the workspace; Linux pins the destination directory while downloading. At
most two stage requests, including body intake, are admitted at once; a busy
request must be retried. `/fs/read` streams an opened regular file within the
20 MiB read cap and fixes its range before sending bytes, so later growth does
not bypass the limit.

A file may carry an immutable `sourceId` (or `cacheKey`) supplied by the platform,
or a `sha256` digest for content verification. runnerd
keeps up to 4,096 source/digest entries in memory and skips an unchanged source
only after hashing the actual destination again and verifying that the file
and its workspace path still refer to the same unchanged regular file.
Named pipes are rejected without waiting for a writer. A source-only entry probes
that cache: a verified hit is `staged`; a miss reports `no_source` and requires
the bytes or URL. Restarting runnerd loses the cache and causes a refresh.
This does not cache grants, credentials or source authorization: callers must
resolve those for the current turn.

After every transfer batch succeeds, a final empty `files` request may supply
`replaceRoots` and `keepPaths`. This explicitly reconciles fully managed input,
skill or mount directories, removing files absent from the final list while
preserving paths elsewhere. The workspace root itself cannot be reconciled.
A successful response includes `reconciled: true`; older runtimes omit it, so
the platform uses its prior clear-and-restage behavior during a mixed rollout.
Never send a final manifest for a failed or unfinished transfer batch.

The build-cache upkeep — the reconcile for the organizations whose agent
sessions adoption just registered, the retirement of legacy helpers and the
stop of idle ones — is a background job of its own: a pass starts it, or joins
the one under way, and never waits for it. A release that changes the helpers'
image makes every organization's helpers drifted, and recreating them takes
seconds per organization, one organization after another; the sweep goes on
every minute meanwhile. Organizations adopted while the job runs are
reconciled by a run right after it.

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
back-off instead of costing every create at capacity a health timeout. Nearly
every running turn is a candidate by the spawner's own count (the platform
ends each exec stream at its drain window and follows the turn by attach), so
the walk spares the busy ones: a daemon that answered, to a reclaim probe or
to the sweep's, that its session cannot be reclaimed (held by a turn, working,
pinned, or too old for the claim), or whose session a turn acquired through
this spawner, is not asked again for 15 seconds unless the platform releases
that session through this spawner; a walk probes at most eight daemons, the
sessions last seen released first, then idle-longest first; and for three
seconds after a walk that found nothing, the creates refused at capacity are
answered at once. A stop
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
render 512 MiB), and each session started in the last 90 seconds at the part
of it a linear decay leaves (its turn is still growing into it while
MemAvailable shows only the idle footprint), the host must keep
`SANDBOX_MIN_FREE_MEMORY` free (a tenth of it, at least 1 GiB). Short of it,
the create reclaims a released idle session like one at capacity, then
answers 429 `host_memory`. The decision is taken under the
admission lock from a reading the probe refreshes every second, so a burst
sees each create admitted before it. Unknown memory never refuses a create,
and the check cannot stop sessions already running from growing past it.

Warm idle-to-active acquisitions use the same memory guard and FIFO as new
creates. They renew the 90-second growth reservation for the actual Docker
capability of that incarnation; repeated acquisition of already active work
shares the reservation. Only a release acknowledged by runnerd's current
generation gives it back early. An old release cannot free newer work's budget.
Direct exec requests also enter admission when no recent activation is held.
A refused activation returns 429 `host_memory` with queue position and
`retry-after`, preserving its workspace and compute for retry. Warm waiters
hold memory in the line, but consume no additional session slot. These checks
apply only where the Docker host's memory can be verified, and do not impose a
hard aggregate memory limit on already-running work.

On the Docker backend, admission also keeps a floor of free space on the disk
the workspaces live on — the session root, read with `statfs` every five
seconds (`host-disk.ts`): `SANDBOX_MIN_FREE_DISK`, a twentieth of the disk,
at least 2 GiB and at most 20 GiB (`0` turns it off). Below it every create
answers 429 `host_disk`; no idle session is reclaimed for it, since a stopped
session keeps its workspace. The spawner logs the disk going below its floor
and coming back. Meanwhile each build-cache upkeep removes the helpers and
caches of organizations whose helpers are all stopped and that no session or
create may use, the longest-stopped first, at most three a run and only while
the disk stays short; a removal that frees nothing on that disk (the caches
live on another one) pauses the removals for six hours.

**Room goes first come, first served.** A create refused for room (429
`session_quota`, `host_memory` or `host_disk`) waits in a line, by session id, in the
order of its first refusal; asking again keeps its place. Room that frees
next is the oldest waiters': a create gets in ahead of them only where there
is a free slot for each of them as well, and memory for their planned
working sets beside its own (a waiter whose working set this host could
never fit beside its reserve holds no memory). The refusal says where the create stands —
`queue: { position, waiting }` in the body — and when that place comes up:
`retry-after` is 5 s for the front and 5 s more per place behind it, up to
60 s, so a waiter that comes back when told is first when room frees, and
one that asks rarely no longer loses to every one that asks often. A waiter
that stops asking (twice its hint and 15 s more without a word) gives its
place up, a destroy of the id takes it out, and the line keeps at most
10,000 waiters. It lives in the spawner's memory: a restart starts it
afresh, and each Kubernetes replica keeps its own.

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

A pin change succeeds only after runnerd and the backend's durable record
acknowledge it. Failure returns 503 and keeps the last acknowledged `pinned`
value visible with `pinSynchronized: false`, so platform reconciliation retries
even when a canceled toggle happens to match that old value. The affected
incarnation remains protected while the pin is uncertain. Pin writes serialize
with each other and local replacement; backend incarnation fences reject a late
write to a replacement container or Pod. Only an acknowledged true-to-false
transition renews the normal TTL; repeating an unpin does not extend it.

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
five-minute sweep.

Out of use is not deleted, so every destroy answer that is not busy says how
far the bytes came, in `deletion`: `done` once no trash entry of the id is
left, `pending` while one waits or is being deleted, `failed` while the last
attempt at one failed. It is read from the trash itself, so a restart turns
nothing still on disk into `done` (a failure is remembered in memory only:
after a restart the entry reads `pending` until a pass has tried it again).
Only the id's own entries count (`ses-<id>.<uuid>`), never a fresh `ses-<id>`
a later session laid out. `?await_deletion=1` — the platform's
[workspace cleanup](#workspace-cleanup) sends it — has the entries attempted
now, a failed one again, and waits up to 10 s for them before answering; an
interactive Destroy does not wait.

`.trash/` is a dot-dir: the workspace inventory, the host-dir sweep and the
resume resolver never take it for a workspace. Where the rename cannot happen
(another filesystem, a disk too full for the directory entry), the workspace is
deleted in place before the answer, as it was before the trash, and a failure
there answers 502.

On Kubernetes the destroy's deletion is the PVC delete: once the API accepted
it, Kubernetes removes the claim when nothing mounts it, and the volume is its
storage provisioner's to delete under the StorageClass's `reclaimPolicy` —
bytes the spawner cannot observe. So it answers `deletion: handed_off`, never
`done`, and the platform records which contract a deletion settled on. Every
backend states its contract (`SessionBackend.workspaceDeletion` is required):
an answer without `deletion` comes from a spawner or device older than this
contract — one that already renamed into its trash and deleted in the
background — and the platform reads it as unconfirmed, never as done.

The device hub keeps a destroyed session's placement, marked deleting, until
its device answers `done`: while the device is still deleting (`pending`,
`failed`), or is too old to say, the destroy that asks again reaches the device
holding the bytes rather than the hub's own backend. The hub asks again itself,
at most every 5 minutes per placement and least recently asked first, so a
placement ends once its bytes are gone even when nothing destroys or creates
the id again (a run's reclaim never does). Such a placement is no session — the
capacity view leaves it out — and a fresh session under the id is placed like
any other, trying that device first, so a new session never waits on an old
workspace's bytes.

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
- `DELETE /v1/sessions/:id?if_idle=1&if_stopped=1&await_deletion=1` — the
  cleanup's destroy: `if_stopped` refuses (`{busy:true}`) while any compute runs
  under the id or a create of it is in flight; `if_idle` rides along so a
  spawner or device that predates `if_stopped` still refuses a live exec. An
  erasure sends neither condition, and an owner's deletion `if_idle` alone.
  `await_deletion` waits a bounded time for the bytes; the platform settles a
  deletion — the rows destroyed, the audit row, the erasure's count — only on
  `deletion: done` (or Kubernetes' `handed_off`, recorded as such). `pending`,
  `failed` and an answer without `deletion` leave the workspace for the next
  attempt (the sweep defers it, the owner's and the organization's jobs throw
  for the queue's retry, an erasure's pass fails so the receipt reads
  partial), and `failed` is audited as a failed deletion. Destroys of one id
  run one after another, and a create of an id waits for a destroy of it under way —
  up to two minutes; past that it answers 429 busy (`retry-after`), so a
  destroy wedged on its filesystem never holds the create and its capacity
  slot for ever. On Docker, destroying an id discards every flat and legacy
  workspace copy plus the workspace its container actually mounts, even if
  the configured session root moved. The organization marker stays until all
  copies are discarded; an unreadable directory or an unknown container mount
  defers the destroy. A failed create uses the same verified cleanup: existing
  workspaces survive a failed resume, and failed removal retains ownership so
  the platform can retry cleanup.
- `DELETE /v1/organizations/:id` — for an organization the platform deleted:
  destroys every session the backend still holds for it (containers/Pods with
  their workspaces) and every stopped workspace attributed to it, then its
  build helpers, their network and volumes, and its package caches (Docker;
  Kubernetes keeps nothing per organization beyond PVCs). A workspace list
  that cannot be read leaves the stopped ones to the platform, which names
  every workspace its rows knew. 409 while a create of the organization is in
  flight, 502 on a failure; idempotent. A package cache is the spawner's by its
  `tale.sandbox-cache` label, and the teardown refuses a volume under a cache
  name without it. Docker makes such a volume itself when a session mounts a
  cache that was pruned while the spawner still took it to be ready (for up
  to five minutes after it last checked): root-owned and unwritable to the
  sessions. The organization's next create past that window replaces it with
  a labelled, writable one, or makes it writable while a session still holds
  it and replaces it at a later check.

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
512 MB `/tmp`; the `SANDBOX_AGENT_*` settings override these limits. The memory
default follows each session's actual Docker capability, including a workload
policy or request that disables Docker. An explicit `SANDBOX_AGENT_MEMORY`
applies to both Docker and Docker-free agents.
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

### Checkpoint and staging protocol

`GET /v1/sessions/:id/exec/:execId/checkpoint` returns `{checkpoint: null}` or
`{checkpoint: {seq, state}}`. `PUT` accepts `{seq, state}` up to 1 MiB; it rejects
invalid/future cursors with 400, stale checkpoints with 409 and oversized bodies
with 413. State is opaque to the sandbox. The platform saves parser state,
partial JSONL, background-task state and its bounded progress projection every
five seconds and at a drain handoff before acknowledging replay. A 404 from an
older runtime retains the legacy path during a rolling upgrade.

Staged files accept optional `sha256` and `cacheKey` fields. The runtime verifies
existing content against its manifest before skipping a transfer; it never
trusts the platform's claim alone. Downloads use two lanes, a shared 25-second
budget and atomic temporary-file renames. Cancellation reaches the runtime.

`agent-light` uses the same non-root agent identity and persistent workspace as
`agent`, without Docker or BuildKit. The backend's `SANDBOX_AGENT_PROFILE` chooses
new workspaces; saved profiles survive stop/resume and pin reconciliation.
Released-session acquire performs memory/disk admission and may return 429,
which the platform handles as a capacity wait.
