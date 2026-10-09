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
> host lifecycle (boot/shutdown, `/health`, the legacy-orphan sweep). On
> Docker that sweep's one-shot container listing runs at boot and then
> hourly; the five-minute host sweep keeps retrying the workspace trash and
> reaping orphaned DinD volumes.

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
drops. A cancel or a live exec's deadline ends its processes at once, what it
left waiting included, and the SIGKILL reaches its group while its own
process still runs even if no process there shows the id. A
backgrounded server, a `nohup` worker or a browser therefore no longer runs on
in a session that reads idle until the container stops. Each process gets one
SIGTERM, so a second signal never cuts short the cleanup the first one started.
Once terminal journal drain begins, attach can replay but cannot re-arm the
orphan deadline or reap sibling-dependent leftovers. Status remains running
until the terminal record is durable; an explicit cancel still ends waiting
leftovers. The start record keeps its epoch `startedAtMs`, while exit
`durationMs` measures spawn-to-drained-exit elapsed time using a monotonic clock,
so a backward wall-clock adjustment cannot produce a negative duration.

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

**An exec's command ranks above runnerd for the OOM killer.** runnerd keeps
the score its container starts with (`--oom-score-adj=500` on Docker); before
the shim runs the command it raises the command's adjustment to 900, never
lowering a higher one, and everything the command starts inherits it, while
the shim itself keeps runnerd's. When a session reaches its memory limit, the
kernel's OOM killer, which picks the highest score, ends a build or a test run
before runnerd, whose end would be the container's and every exec's in it.
Raising a score needs no privilege, so this holds with every capability
dropped; where the kernel has no such file or refuses the write, the command
runs with the score it inherited and nothing is reported.

runnerd is the only child of the container's init, so its end is the
container's, and every exec in it ends too. An error nothing handled does not
take the session with it: an unhandled promise rejection (which Node 24 turns
into an exit) is logged and survived, as in the spawner; an uncaught exception,
after which the daemon's state is unknown, stops runnerd the way SIGTERM does
(live execs told to end, the two-second forced deadline still holding) and it
exits 70 (`EX_SOFTWARE`), apart from a stop's 0 and a signal's 128 + N, or by
SIGKILL when that deadline passes first.

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
gets its signal as a whole. A process in the middle of an `execve` has no
environment yet and reads as empty — a leftover often is right there when a
round comes — so runnerd reads such a process again, four times ten
milliseconds apart, before it counts as untagged.

A shim that exits normally has waited for every descendant to end. Its later
SIGKILL round therefore reads neither the process table nor environments. A
shim killed by a signal does not provide that proof: runnerd falls back to
group records and tags. In a mixed tag scan, an intermediate whose environment
read stalls still contributes its already-read parent/group information to
the descendant walk. A stalled `stat` read cannot provide that information;
its subtree may remain undiscoverable until a later scan.

Each cleanup round indexes its process snapshot once by execution tag, parent,
group and PID. All retained executions use that index, and ancestry walks
visit their descendants without shifting the remaining queue on every step.
This keeps unrelated executions from multiplying the matching work as a
session accumulates background processes. The indexes live only for that
round; later rounds still take fresh snapshots and verify recorded PIDs with
their start times before treating a reused group as owned.

**A rotation keeps what the turn started.** A steer's restart cancels a
running turn and continues the conversation in a new exec over the same
workspace, so the platform sends that cancel as a rotation:
`POST /v1/sessions/:id/exec/:execId/cancel?leftovers=keep`, which the spawner
forwards to runnerd's `POST /execs/:id/cancel?leftovers=keep`. runnerd then
ends only the exec's own process group (SIGTERM, then SIGKILL five seconds
later while its own process or a proven group member still runs) and holds what it left outside the
group, such as a dev server a harness's tool call started in a session of its
own, for the exec that takes over. The hold lifts when an exec started after
the cancel ends without itself being rotated; chained rotations keep earlier
holds until a successor actually finishes. The leftovers then end with the session's last running exec,
as above, or when runnerd stops. A hold that sees no successor within ten
minutes (a restart whose new exec never started) lifts too, and with no exec
running its leftovers end at once. A later cancel of the handed-over exec (the
platform's superseded drive still reaps the exec it no longer owns) ends none
of what it holds; a person's Stop goes to the exec that took over, and its
end ends them. A plain cancel ends everything; a spawner or runnerd that
predates the flag ignores it and does the same.

Without a shim, a rotation snapshots the group before SIGTERM, while the
leader still proves ownership. That stat-only scan is bounded to two seconds;
if the leader exits before it completes, its snapshot is discarded. The
group-only rounds use recorded pid/start-time pairs or an exec tag still in
the group, not an unverified group number, and never signal held processes
outside the group. When the leader exits during the snapshot, tag fallback
still reaches tagged survivors; without a live subreaper, those fallback
rounds may read environments.
A survivor that removes its tag and leaves the group remains out of reach
without a working subreaper. So does a group whose entire recorded membership
has been replaced by newly forked, untagged processes after the leader exits.

**Session teardown is best effort, not a wrapper-cleanup guarantee.** runnerd
passes SIGTERM to execs when it receives a graceful stop, but does not await
their completion before exiting. On Docker a stop removes the container with
`docker rm --force`, which kills at once and delivers no graceful stop; only
the max-linger self-reap's stop of a busy session asks first. Busy is an exec
running through this spawner or, failing one, a live exec or an operation
under way as runnerd's health reports it (asked with a 3 s bound): the
platform follows a long turn by attach and hangs up at every drain window, so
an exec it is draining is usually registered in no spawner. A daemon that
does not answer could not act on the stop and is removed at once. The
max-linger self-reap stops a busy session with `docker stop -t 5` (`-t 20` for
a Docker-in-sandbox session, whose supervisor also shuts its inner engine down
and whose dockerd waits up to 15 s for its own containers) and then removes it,
inside the same lifecycle serialization as every other stop: a sweep or an
idle reclaim already stopping the session is joined, never cut short. Idle
stops, pressure reclaims, failed-create cleanup and destroys still remove at
once: an idle session has nothing to end, and a destroy deletes the workspace
and the inner image store a grace would flush into. Kubernetes deletes every
Pod with a 5 s grace period. The unit tests prove the manager's signal
delivery and which stops ask first, not the timing of wrapper completion.

Avoid `pkill -9 -f '<command>'` for managed execs: the shim's argv contains the
command too, so that pattern can kill the shim. runnerd then reports the shim's
signal exit (137) if no command status was received, and falls back to reaping
by tag/group. Cancel through runnerd instead; SIGKILL cannot be caught.

**No `kubectl exec`/attach anywhere** — runnerd is reached by ordinary HTTP, so
the exec-free K8s constraint holds. runnerd auth is the per-session token
`HMAC-SHA256(SANDBOX_TOKEN, "runnerd-v1:" + sessionId)` in the
`x-tale-runnerd-token` header — derivable by any spawner replica, stored
nowhere. `SANDBOX_TOKEN` is required (the spawner refuses to boot without it —
`loadConfig` fails closed), so every session carries a real token and runnerd
always verifies; there is no unsigned mode.

The Docker backend also launches each session container with
`TALE_RUNNERD_INCARNATION` set to its creation stamp, the value of its
`tale.created` label; the env patch route refuses the reserved `TALE_RUNNERD_`
prefix, so session code cannot rename it. runnerd names that stamp as
`incarnation` in `/healthz` and in every activity answer (release ticket,
acquire, release, reclaim, pin). An activity request whose
`x-tale-runnerd-incarnation` header names another stamp is refused with
`409 incarnation_mismatch`, naming runnerd's own, before anything changes, so a
replacement under the session's name is never acquired, released, claimed or
pinned for a stale registry entry. Once runnerd has named the registered stamp
(in the create's readiness answer, an activity answer or a sweep probe),
acquire, release ticket and release skip the backend's `sessionExists` check (a
`docker inspect`), and a session read asks `/healthz` instead. The sweep of a
pinned session asks `/healthz` first and needs no backend check when the answer
names the registered stamp; both probes are bounded at 1.5 s. An answer naming
another stamp evicts the stale entry and keeps its workspace. A failed runnerd
call, or an answer naming no stamp (an older runtime image), falls back to the
backend check. Kubernetes keeps the backend check throughout: a terminating Pod
still answers through its IP after the backend counts it gone.

Image warming runs beside control startup and session adoption. While a cold
runtime image is being pulled, new local creates return `429 runtime_image`
with `Retry-After: 5`; health, limits and existing-session operations remain
available. A failed pull does not end that wait: while the image is absent
every create would fail, so creates keep answering `429 runtime_image` (with a
`Retry-After` of 5–60 s that follows the next attempt) and the pull is retried
after 30 s, 1, 2, 5 and then every 10 minutes. Session containers run with
`--pull=never`: an implicit pull of the multi-gigabyte image could never finish
inside the run's 30 s budget. A create that finds the image gone (an
`image prune` on an idle host removes it, since stopped sessions keep no
container) restarts the warmup and answers `429 runtime_image` instead of
`502`. `GET /health` reports the image's state (`unchecked`, `pulling`, `ready`
or `missing`, with the last error) without turning unhealthy over it.
Device-placed creates follow the target device's readiness.

Docker create failures remove only a container bearing that attempt's private
ownership label, using its immutable container ID. A concurrent replacement
and its workspace survive. Every workspace directory and owner marker,
including an empty directory created during failed setup, remains for retry
or explicit destroy. Ambiguous inner-Docker volumes remain for ordinary
orphan cleanup. Kubernetes failed creates use a separate 30-second cleanup
budget after cancellation or failure: only acknowledged Pod and Secret UIDs
can be removed, observed Pod deletion also fences its resource version, and
workspace PVCs and ambiguous API outcomes remain for retry or recovery.

A create that loses the session's deterministic name to a LIVE session this
spawner's registry does not hold — a running container of this spawner's
instance, or a Pod that is neither terminating nor ended — answers
`409 duplicate`, as a create of a registered session does: the platform then
adopts it through acquire, and the registry-miss resolve below registers it.
Answered as `502 create_failed`, the platform would clean up after a failed
create and remove that session's compute. A name held by anything else (a
container still `created` or being removed, a terminating Pod, one that
cannot be read) stays a `502`, and nothing under the name is touched.

A session absent from this spawner's registry is resolved from the backend.
If that inventory or endpoint lookup fails, or an existing nonterminal runtime
is still starting, session routes return `503 session_unavailable` with
`Retry-After: 1`. A local create still in progress answers the same way. The caller retries without
declaring the running session lost or recreating it. The platform's acquire and create ask again at
the `Retry-After` for up to 20 seconds, and wait out a refused, reset or unresolved connection to the
spawner (a restart) within the same budget, before the turn's start fails. A confirmed missing or
stopped session still returns 404 so its preserved workspace can be resumed.

A running task or automation agent turn rides out a spawner it cannot reach. runnerd keeps the exec
running in its session while the spawner restarts, crashes or is cut off, so the platform's drain
reads a transport failure — no connection, a stream that broke mid-read, a `429`, `502`, `503` or
`504`, a call that timed out — as an outage rather than a verdict on the turn: it waits the
`Retry-After`, or a backoff doubling from 250 ms to 5 s, and attaches again after its cursor,
without spending its budget of five consecutive failures. A drive window that ends with the stream
still lost ends `running`; the next window follows five seconds later, resumes from the exec's
checkpoint and carries when the outage began. Only an outage that lasts 10 minutes — at most a third
of runnerd's orphan window (`TALE_EXTERNAL_TURN_DEADLINE_MS`, counted from the last attach) —
settles the run as failed, once and with the exec cancelled first; the work-turn deadline still
applies. A 404, a replay or protocol gap and an error the stream itself reports stay verdicts, and
so does the hub's `503 device_offline` for a session on a connected device that went away: the
spawner answered and the device may stay away for hours, so the drain fails on its budget of five
consecutive failures (about 7.5 s), naming the device, instead of waiting 10 minutes for it.

A restarted spawner answers before it has re-adopted its sessions. Once its host lock and boot sweep
are done it opens its listener, and until boot adoption has run and the device hub has loaded its
placements, every session route — and the workspace inventory, the capacity read, an organization
teardown, a device disconnect and the deploy's `/v1/drain` and `/v1/drain-status`, whose answers
depend on them — returns `503 session_unavailable` with `Retry-After: 1`, never a 404 the platform
would take for a lost session. A restart thus reads to the platform as a few seconds of "not now",
which its acquire, create and drain wait out, instead of refused connections; `/v1/limits` and
`/v1/devices` answer as before. `/health` answers `503 {"status":"starting"}` until then, so
Docker's healthcheck, a Kubernetes readiness probe and the CLI's runtime wait still read the spawner
as ready only once it has adopted its sessions: a rollout keeps the previous Pod serving meanwhile,
and Compose, which routes by network alias whatever the health, still delivers the 503s. The drain
waits too because a drain latched during adoption would stop it part-way, leaving the sessions not
yet adopted to answer 404, and the drain status would count only the sessions adopted so far, so a
deploy would read the spawner as drained and restart it under running sessions; the deploy's failed
control call leaves its activation pending, to be retried.

The in-memory session registry is a **cache, not the source of truth**: the
backend objects (container/Pod labels + annotations) plus runnerd's activity
clock are authoritative. On boot the spawner re-adopts running sessions
(`SessionRoutes.adoptExisting`), resolving at most eight endpoints at once so
Kubernetes recovery does not wait for each Pod read in turn. If draining begins
during recovery, no further peer session is adopted, including one whose
endpoint read was already in flight. Adoption verifies the listed creation
stamp when resolving the endpoint. Periodic adoption refreshes a replacement's
metadata and endpoint together. Late probes and cleanup from the old incarnation
cannot launch an exec or clear the replacement's activity or exec state. Liveness
checks distinguish the
registered incarnation from another running object under its name, while an
unreadable identity remains unknown. On Docker a runnerd answer naming the
registered creation stamp counts as such a check, and one naming another stamp
shows the registered incarnation is gone. Linger stops also use the creation
fence.
A maintenance pass every minute
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
  Docker inside keep the full window once their inner engine has run: their
  resume starts the inner daemon on an empty image store. runnerd's `/healthz`
  reports this as `docker.used`; a session whose engine never started gets the
  short window, and a runtime that does not report its engine keeps the full
  one;
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
  session registered under the id, nor counts as that session's stop;
- compute that never got going: a Kubernetes Pod still Pending past its
  creator's startup deadline, or a Docker container still `created`, `paused`
  or `restarting` (a spawner killed between the daemon's create and start, or
  a timed-out run whose cleanup also timed out) once its create's whole
  budget (`SANDBOX_SESSION_CREATE_TIMEOUT_MS`) and a minute's slack have
  passed since both its `tale.created` stamp and Docker's own creation time.
  Such a container used to hold a capacity slot for ever, answer every create
  of the id busy, pin an old runtime image and outlive spawner restarts. It is
  removed by the container id read with its state, with its inner image
  volume; the workspace stays. One whose stamp names another incarnation than
  the one listed is left alone.

Every such stop is fenced to the incarnation the registry or listing
describes, and keeps the workspace. The pass probes at most eight daemons at a
time, so a few hung ones bound it rather than the sum of every probe.

Exec output consumers have an 8 MiB pending-write ceiling. When a reader
falls behind, runnerd disconnects it and releases its socket, buffered writes
and request activity. Attach replay observes socket backpressure directly and
disconnects a reader that has not drained for two seconds. Other readers and
the command continue under the existing exec deadline. A dropped consumer does
not keep an idle session busy after the command ends.
The spawner also detaches its runnerd response reader if its parser or output
consumer fails, before a retry can open another attachment. Malformed JSON,
invalid payloads, invalid UTF-8 or oversized records fail with
`REPLAY_UNAVAILABLE`; missing sequence numbers or sequence gaps fail with
`OUTPUT_GAP`. Exceptions from the output consumer also end the attachment.

Reconnect through `/execs/:id/attach?sinceSeq=<last-seen-seq>`. The protocol
is retained in a disk-backed spool under `/agent/.runtime/tmp` on the workspace disk, limited to **64 MiB of unacknowledged
encoded NDJSON per exec** and **256 MiB of physical replay and checkpoint
storage per session**, including files held open by readers. At most four
execs run at once and 16 exec records are retained. Completed spools are
evicted first under the shared budget. An active writer that exhausts its
budget ends with `OUTPUT_LIMIT`; unavailable or evicted history reports
`REPLAY_UNAVAILABLE`, and a journal or checkpoint write the disk refuses for
want of space (`ENOSPC`, `EDQUOT`) ends the exec with `REPLAY_DISK_FULL`. The spawner forwards each
of the three as the code of the stream's terminal `error` event; the platform
ends the turn on it without reattaching, and names `REPLAY_DISK_FULL` in words of its
own: the sandbox host ran out of disk space. The full-disk code carries the
`REPLAY_` prefix on purpose: a platform older than the runtime already ends a
turn on every `REPLAY_` code instead of reattaching. The disk-backed spool is
the sole retained output history.

A checkpoint is committed (written to a temporary file and renamed into
place) before its acknowledged prefix is pruned, so a run can produce more
than 64 MiB over its lifetime while the consumer keeps acknowledging progress.
A `gap` event identifies any pruned sequence interval; consumers restore the
committed checkpoint before continuing. Spool segments and checkpoints live
under the runtime-owned `TMPDIR`; normal disposal removes them and startup
clears that directory after a crash. A runtime restart loses execs and
checkpoints, and never clears user files elsewhere in the persistent
workspace. Because no checkpoint is read after a restart, the commit is not
synced to disk: a sync per checkpoint (one every five seconds per streaming
turn) would flush the filesystem journal for nothing, and a slow one past the
five-second replay I/O deadline would end a healthy exec.

An attach sends `replay-start` before retained history and `replay-complete`
with `throughSeq` after delivering the
historical prefix that existed when attachment began. Clients must reconstruct
protocol state through that boundary before treating a historical turn result
as completion; a process `exit` is authoritative independently. Older runtimes
omit these markers. Consumers retain their legacy completion behavior only
while replay sequence continuity is verified; an observed gap fails the replay
rather than treating a suffix as complete history. Complete journal replay
requires the runtime, spawner and platform to be upgraded together; older
runtimes retain their bounded ring replay during a rolling upgrade.

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

The platform folds parsed events into a bounded display projection, with a
32,000-character live text tail and bounded timeline payloads. Its progress
writer holds at most one active write and one replaceable pending snapshot,
then flushes before settlement. Output/control replay remains independent of
these display limits. Unchanged staged files are reused only after checking
their current digest; each turn still checks the caller's authority and removes
stale files from the requested input mounts. Artifact harvesting enforces its
read limit while receiving file bytes and uploads the existing buffer without a second
full-size copy.

Pin changes persist the desired value and a delivery job in one transaction.
Delivery reads the latest value under the session lifecycle lock and retries
until acknowledged or that incarnation is gone. Repeated Unpin delivery does
not extend expiry. The watchdog runs its four independent reconciliation and
cleanup passes concurrently, with one remote operation per pass and a
120-second deadline per pass, so an unreachable session cannot starve every
cleanup lane.
The default reconcile batch reserves 20 probes for active sessions and five
for retained unpinned incarnations, rotating each group independently and
interleaving a retained probe after every four active probes. Historical pin
repair cannot fill the active health-check slots or retire an absent workspace.

The build-cache upkeep — the reconcile for the organizations whose agent
sessions adoption just registered, the retirement of legacy helpers and the
stop of idle ones — is a background job of its own: a pass starts it, or joins
the one under way, and never waits for it. A release that changes the helpers'
image makes every organization's helpers drifted, and recreating them takes
seconds per organization, one organization after another; the sweep goes on
every minute meanwhile. Organizations adopted while the job runs are
reconciled by a run right after it. Each run lists the helpers with their
state, so an organization whose helpers all stopped costs no inspect; its
builder's stop time is read once and again only when the cache retention
could have passed since. With the build cache off (as it is wherever
sessions run no Docker inside, the `runc` default), a helper list that came
back empty is read again only hourly, which still finds the helpers a
deployment that had it on left behind.

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

On the Docker backend, admission also keeps a floor of free space on the
workspace filesystem and Docker's metadata filesystem where it can be verified.
`statfs` reads the session root and the verified Docker hostname bind every
five seconds (`host-disk.ts`). `SANDBOX_MIN_FREE_DISK` sets the floor on each
filesystem; unset, it is a twentieth of each, at least 2 GiB and at most
20 GiB (`0` turns it off). Below either filesystem's floor every create
answers 429 `host_disk`; no idle session is reclaimed for it, since a stopped
session keeps its workspace. The spawner logs the disk going below its floor
and coming back. Meanwhile each build-cache upkeep removes the helpers and
caches of organizations whose helpers are all stopped and that no session or
create may use, the longest-stopped first, at most three a run and only while
the disk stays short; a removal that frees nothing on that disk (the caches
live on another one) pauses the removals for six hours. If a different
filesystem becomes the most constrained after removal, upkeep stops that pass
and reassesses next sweep instead of comparing free bytes across disks.

The floor holds new work back; it does not stop what already runs, which
writes until the disk is full, and with it the replay journal of every running
exec. So the disk also has a critical tier, below which those writes are about
to fail: `SANDBOX_CRITICAL_FREE_DISK`, unset a quarter of the floor, at least
1 GiB, and never above the floor, set or unset (`0` turns it off, and so does
a floor of `0`). The sweep reads it from the same five-second reading, and an unknown or
unreadable disk is never critical. While the disk is below it, the sweep
stops a released, idle Docker-in-sandbox session at once instead of after its
full idle window — through runnerd's claim like every idle stop, so a turn
that acquires it meanwhile keeps it — because its stop removes its inner image
store, the most a stop gives back. It also logs the three largest workspaces,
measured by one `du` of every workspace dir at the lowest CPU priority (and so
the lowest best-effort I/O priority) and cut off after 30 seconds, at most
every ten minutes. The spawner logs the disk going below the tier and coming
back.

The Docker observation reuses the spawner's existing `/etc/hostname` bind.
Its full container identity and source path must agree with the selected
daemon's container inspection and data-root, which bounded Docker metadata
calls verify once per process: the verification stands while the bind's
kernel mount entry stays unchanged (compared every minute from
`/proc/self/mountinfo`, no Docker call) and its `statfs` succeeds. A failed
verification is tried again after thirty seconds, the delay doubling up to
ten minutes while the daemon keeps refuting the bind; one the daemon could
not answer is tried again every thirty seconds. An explicit
`SANDBOX_DOCKER_DATA_PATH` mount is verified the same way, the mount it
lives on standing for the bind. No helper container or extra host mount is created. If the bind
cannot be verified, the spawner logs that Docker disk pressure is unknown
and continues observing the workspace filesystem. This covers Docker's
metadata filesystem, including local volumes only when they share it;
separately mounted volume directories, custom volume drivers, and separate
containerd image/snapshot stores remain outside the check. The floor controls
admission of new work, not disk writes by existing work. Hard per-session
quotas still require [operator-provisioned storage](docker-in-container.md#storage--lifecycle).

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
read namespace occupancy before admitting a create. Pending, unknown and
terminating session Pods occupy slots even when runnerd cannot be addressed;
confirmed terminal Pods do not. A failed inventory refuses the create with
503. Local creates still in flight, including one that completes while the
inventory is being read, count once. Simultaneous creates on different
replicas still have no distributed reservation: use ResourceQuota for hard
namespace resource bounds.

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

Losing compute is not losing the workspace. When the platform's reconcile finds
the compute of an unpinned agent session gone without a Destroy — a host
reboot, a daemon restart, an OOM-killed runnerd, the spawner's own TTL stop —
it settles the row as `stopped` while the spawner's inventory
(`GET /v1/workspaces`) lists the workspace, or cannot be read: the next turn
resumes it in place, same incarnation and harness conversation included. A
render session, or an agent session whose workspace is gone, settles as
destroyed, and so does a session on a connected device: the inventory lists
this host's workspaces only. A create that fails after such a loss removes
only compute (`?keep_workspace=1`, below), never the workspace it would have
re-attached.

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
  defers the destroy. A failed create removes only its own container and
  preserves every workspace and organization marker, including a newly
  created directory. A later explicit destroy performs the workspace cleanup.
- `DELETE /v1/sessions/:id?if_idle=1&keep_workspace=1` — compute only: it
  refuses (`{busy:true}`) as `if_idle` does, and otherwise stops the session
  (`backend.stopSession`) and keeps its workspace, answering
  `{stopped, busy: false, workspaceKept: true}`. The platform sends it after a
  failed create of an agent session (`agent_session.ts`) and from the
  watchdog's collect of such a failed row: the id may name a workspace kept
  for its next turn, and deleting what nothing owns is this cleanup's. The
  device hub leaves the placement of a session whose device kept the workspace
  as it was. A spawner or device older than the flag destroys instead, and its
  answer carries no `workspaceKept`.
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

The create body accepts `docker: false` for an `agent` session
that does not need to build or run containers. Omitting the field keeps the
deployment's profile and workload policy. The optional `workload` field is
`project` or `workflow`; `SANDBOX_DOCKER_WORKLOADS` controls which workloads
may use inner Docker. An explicit `true` cannot grant a capability the
deployment or workload policy disabled.

An opt-out keeps the hardened runner, skips inner-daemon and build-helper
provisioning, and uses the shared per-organization dependency caches on Docker.
Its admission estimate is 512 MiB, and its released idle window is the normal
five-minute default. An agent with inner Docker uses the 1.5 GiB admission
estimate and retains the full idle window once its inner engine has run.
These estimates are admission headroom, not memory limits. The actual
capability is returned as `session.docker` and recorded on the container or Pod
so a spawner restart preserves that session's behavior.

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
install past the tmpfs size would die with ENOSPC. The dir dies with its
container, preserving the old /tmp lifecycle: a Docker stop renames it into
the session root's trash once the container is gone (the workspace being the
agent's, a `.runtime` or `tmp` that is not a plain directory, such as a
planted symbolic link, is left alone), and the background pass deletes it. At
every container (re)start — no exec is live then — the entrypoint renames
whatever is left aside as the profile uid and deletes it in the background at
idle priority, so a large leftover (the replay spool, a pip staging tree)
never delays runnerd's readiness. `/tmp` remains for small control files such
as redsocks.conf.

## Kubernetes specifics

One long-lived Pod per session (`buildSessionPod`), `restartPolicy: Always`
(a runner crash restarts in place against the surviving workspace; runnerd
re-boots idempotently → brief `degraded` blip, session intact). Single
`runner` container — staging/harvest are runnerd's job, so there is **no** stage
initContainer / harvest sidecar. `automountServiceAccountToken: false`,
startup and readiness probes on unauthenticated `/readyz` (including requested
inner Docker), and a daemon-only `/livez` liveness probe so unhealthy Docker does
not restart runnerd underneath active work. A per-session Secret
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
