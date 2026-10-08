# @tale/sandbox

Tale sandbox spawner manages reusable `@tale/sandbox-runtime` sessions on
Docker or Kubernetes. Each session runs runnerd, which starts commands, streams
output, and manages workspace files through the authenticated session API.
Project agents reuse their workspace across tasks; workflow runs share a
session across their agent and script nodes; crawler render sessions are
destroyed after their batch. See [the session contract](docs/sessions.md).

The Docker backend mounts `/var/run/docker.sock` (host root — an accepted threat boundary) and
writes session state under the host session root mounted at
`/var/lib/tale-sandbox/sessions`.

```bash
bun run --filter @tale/sandbox dev    # bun --hot src/server.ts (local session root in /tmp)
bun run --filter @tale/sandbox test   # bun test
```

Set `SENTRY_DSN` to enable optional Sentry-compatible error reporting, including
GlitchTip. `SENTRY_ENVIRONMENT` and `TALE_VERSION` identify the deployment and
release; events carry `tale.role=sandbox`. HTTP handler failures, failed background
tasks and genuine unhandled errors are reported. A verified client abort or a
closed SSE stream after cancellation is expected and sends no event. Request
bodies, cookies and credential headers or URL tokens are omitted or masked using
the same privacy filter as the platform backend. Stack frames and error messages
are sent unchanged. Unset `SENTRY_DSN` disables reporting, and the spawner
then never loads the reporting SDK; likewise only `SANDBOX_BACKEND=kubernetes`
loads the Kubernetes API client. Each would hold 60–100 MiB of memory for
nothing, and `src/import-footprint.test.ts` keeps both out of a Docker
spawner's (and a connected device's) boot.

Exec and attach streams bound their pending output to 8 MiB plus at most one
event (a collected terminal result can be larger). A consumer that stays
behind is disconnected; cancelling its response also stops the upstream read
and keepalive immediately. The exec keeps running and can be reattached through
the session API. Late output is discarded without repeated log messages.
The runnerd response reader also cancels its upstream stream and releases its
lock when parsing or forwarding fails, so retries do not retain old output
subscriptions. Malformed JSON, invalid payloads, invalid UTF-8 or oversized
records fail with `REPLAY_UNAVAILABLE`; missing sequence numbers or sequence
gaps fail with `OUTPUT_GAP`. A failing output consumer also ends that attachment.

Cold runtime-image warming runs in the background. New local sessions wait
with `429 runtime_image` and `Retry-After: 5`, while control, health and existing
sessions remain available. Session lookups whose backend inventory or endpoint
cannot be read, or whose nonterminal runtime is still starting, answer
`503 session_unavailable` and `Retry-After: 1`; callers retry without treating
that temporary uncertainty as a lost session.

## Authentication

Every route except `GET /health` is HMAC-signed with the shared `SANDBOX_TOKEN`
(`src/auth.ts`, verified by `src/request-auth.ts`). The token is **required**:
the spawner refuses to start without it — it holds the host docker socket and
sits on the sandbox network every session container shares, so there is no
unsigned mode. `tale deploy` and `bun run dev` mint it into `.env`;
`compose.dev.yml` carries an insecure dev default for the dockerized dev stack.

The deploy's drain (`tale deploy` → `drainSandbox`) calls the control routes
through the signed client from **inside** the container, so the secret never
leaves it:

```bash
docker exec tale-sandbox bun /app/src/control-cli.ts drain          # refuse new sessions
docker exec tale-sandbox bun /app/src/control-cli.ts drain-status   # {draining, sessions, sessionIds}
```

## Capacity observations

`GET /v1/limits` uses the same HMAC authentication as session operations and
returns the configured `maxSessions` without requiring a Docker or Kubernetes
inventory. `SANDBOX_MAX_SESSIONS` is the one deployment capacity shared by all
organizations; unset, a Docker spawner that can read its host's memory sizes
it from that memory (one session per 768 MiB beyond the reserve, or per
1.5 GiB where agent sessions run Docker inside, at least 8, at most 256; at
boot, or at the first sweep that can read it), and 8 applies elsewhere. On
such a host admission also keeps `SANDBOX_MIN_FREE_MEMORY` free (a tenth of
the host, at least 1 GiB), counting creates still starting at their planned
working set and sessions started in the last 90 seconds at what they are
still growing into: a create that would cut into it reclaims a released idle
session or answers 429 `host_memory`. Admission also keeps
`SANDBOX_MIN_FREE_DISK` free on the workspace filesystem and, where the
spawner's Docker hostname bind can be verified, Docker's metadata filesystem
(a twentieth of each, at least 2 GiB, at most 20 GiB; `0` turns it off). This
does not observe separately mounted volume or containerd stores, and does not
cap already-running writers; hard per-volume quotas require operator
provisioning (docs/docker-in-container.md). Below either observed filesystem's
floor every create answers 429 `host_disk`, and the build-cache upkeep
removes the caches of organizations whose helpers are all stopped, the
longest-stopped first. Creates refused for room wait in a
first-come line: freed room goes to the oldest waiter still asking, and each
429 names the create's place (`queue: { position, waiting }`) with a
`retry-after` for when it comes up (docs/sessions.md). At most 12 Docker CLI processes run at
once, each within its own time budget, the wait for a slot included; short
calls (the health probe's `docker version`, the identity and liveness
inspects, the build helper and host memory checks) take a free one of those
or one of 4 more kept for them, and never queue behind long calls. A health
probe that found no slot in time answers unhealthy without caching it.
Cancelling a queued call removes its waiter immediately; it consumes no slot
and never starts the Docker command. Platform adds an organization's three
`sandbox_quota` workload limits (defaults 2/2/2) and refuses a save if the sum
exceeds the current deployment capacity or that capacity cannot be read.
There is no independently configured organization runtime ceiling. With
`?organizationId=` the answer adds `deviceSessions`, the slots that
organization's connected devices offer; the platform's ceiling for that
organization is `maxSessions + deviceSessions`.

Size the ceiling against measured task peaks and the host resources remaining
after platform services and safety headroom. See the
[self-hosted capacity configuration guide](../../docs/en/self-hosted/configuration/environment-reference.md#size-session-capacity)
for the sizing example and how to apply an environment override.

`GET /v1/capacity?organizationId=<id>` uses the same HMAC authentication as
session operations. It returns aggregate runtime occupancy, the deployment
capacity, and only the requesting organization's session ids. The legacy
`sessions.organizationLimit` response field mirrors the deployment capacity
for older clients; it does not represent another organization limit. Platform
shows the organization's runtime count without a denominator. Aggregates are
visible to admins and developers; workspace details remain admin-only.

Docker observations come from labeled containers and Docker daemon totals.
Local Linux hosts also report CPU deltas and used memory (`MemTotal` minus
`MemAvailable`). Remote Docker endpoints retain known totals but leave usage
unavailable; the spawner never substitutes its own machine's usage. CPU needs
two observations no more than 30 seconds apart. Kubernetes reports namespace
Pod counts with unavailable host measurements. Unknown Pod phases count as
occupied until termination is confirmed. A container or Pod with malformed
ownership labels still contributes to aggregate occupancy; only validated
organization/session identities appear in that organization's session list.
Failed or incomplete inventories return 503, never a successful zero count.
Observations coalesce and cache for five seconds, each one a single
`docker ps`; the daemon's totals and kernel, and whether the local endpoint
describes this host, are read once per ten minutes (an endpoint the CLI
could not resolve is asked again after 30 seconds). The spawner image sets
`DOCKER_HOST` to the mounted socket, so it never asks the CLI for its
context. The settings page and each connected device's status refresh every
15 seconds; the page marks unavailable metrics.

The platform builds workspace rows by grouping execution history once per
refresh and projecting only the current and running operations. Historical
spend still contributes to totals, while progress reads transfer only the
last 280 Unicode characters before applying the existing display limit.

Platform quota allocation and physical runtime state have separate lifecycles:
finishing work can release an org allocation while its idle container stays
running. The capacity inventory includes that container until it stops. At
capacity, the spawner can reclaim an explicitly released, unpinned idle session
after runnerd atomically confirms and freezes its activity. Busy or unknown
sessions stay protected; stopping compute preserves the workspace. See the
[session lifecycle contract](docs/sessions.md#capacity-and-idle-reclamation)
for release ordering and failure handling.

## Workspace cleanup

Stopping keeps a workspace; the platform decides when one goes — its owner
(agent, member, organization) was deleted, nobody used it for the
organization's window, or nothing owns it any more — and the spawner reports
and enforces: `GET /v1/workspaces` lists every workspace it holds (stopped
sessions' data included) and the organizations holding build helpers or
package caches, `DELETE /v1/sessions/:id?if_idle=1&if_stopped=1` deletes a
workspace only while no compute runs under it, and `DELETE /v1/organizations/:id`
removes what is left of a deleted organization. All three use the same HMAC
authentication as the session routes. See the
[workspace cleanup contract](docs/sessions.md#workspace-cleanup).

On Docker a destroy moves the workspace into the session root's `.trash/` and
deletes it in the background, so it answers at once however much the workspace
holds; the next start empties whatever a restart or crash left there. Every answer
says how far the bytes came (`deletion`: `done`, `pending` or `failed`; on
Kubernetes `handed_off`), and `?await_deletion=1` waits a bounded time for
them: the platform's cleanup and erasure settle a deletion only on an explicit
`done` or `handed_off`, never on an answer without it (a spawner or device
older than the contract). See
[stop vs destroy](docs/sessions.md#stop-vs-destroy--the-data-preservation-contract).

Docker admission serializes creates and released-to-active acquisitions through the host's single spawner. Each idle-to-active transition reserves its expected working-set growth once.
Concurrent Kubernetes replicas enforce the namespace capacity on a best-effort
basis; use ResourceQuota for hard namespace resource bounds.

## Sandbox devices

Organizations can connect machines of their own (`tale sandbox connect`) to
run their sandboxes. The same image runs there in device mode
(`SANDBOX_DEVICE_CONFIG`) and dials the deployment's spawner, which runs the
device hub on `SANDBOX_HUB_PORT` (published by the proxy at
`/sandbox/tunnel`). The hub places device-eligible sessions on the
organization's devices, forwards every later call to the device that holds
the session (503 `device_offline` while it is away) and relays the device's
sessions' calls to the backend and the model gateway along an allowlist.
`device-apply` lays out and updates a device's containers. See
[the device contract](docs/devices.md).

## Agent Docker capabilities

`SANDBOX_DOCKER_WORKLOADS` narrows the deployment's DinD capability to
`project`, `workflow`, both (the default), or `none`. The platform tags session
creation with its owner workload; an untagged legacy request receives Docker
only when both workloads are allowed. An authenticated create request may also
set `docker: false`. Neither a workload nor `docker: true` enables Docker when
the deployment disables it. The `default` profile never receives Docker.

The actual capability is recorded on each container or Pod and recovered after
a spawner restart. New settings apply to new compute; running sessions retain
their capability. Lightweight agents keep their normal agent uid and tool
permissions, skip Docker storage and build-cache setup, and use the shorter
released-session idle window. Their default memory ceiling is 4 GiB instead of
the 8 GiB used with Docker; an explicit `SANDBOX_AGENT_MEMORY` applies to both.

## Organization build caches

On Docker, each organization has one privileged BuildKit container, three unprivileged
registry mirrors, an internal network and four cache volumes. The spawner
packs `/23` bridges (512 addresses each) into the first available Docker
address pool before advancing, honoring smaller configured pool sizes. An
otherwise unused `/16` holds 128 organization bridges. The allocation excludes
existing Docker networks, the daemon host's routes and DNS servers, and
`172.31.0.0/16` for older runtime images, then validates the created network.
A short-lived observer runs the configured BuildKit image in the daemon's host
network namespace with a read-only filesystem, no capabilities and no mounts;
this works against remote Docker without borrowing the spawner host's routes.
An unused invalid owned network is recreated; an in-use or foreign network is
never removed. If host observation fails or no safe subnet is available,
sessions build locally. Shared cache provisioning has its own
`SANDBOX_BUILDKITD_PROVISION_TIMEOUT_MS` budget (5 seconds by default,
100–60000 ms), including queued Docker calls and helper operations. Independent
registry mirrors initialize concurrently. Each session waits no longer than
that budget or a quarter of `SANDBOX_SESSION_CREATE_TIMEOUT_MS`, whichever is
shorter, before using its local builder. Cancelling a caller ends only its wait;
the shared producer retains its organization lease until its own budget expires
or it finishes. Expired queued producers cannot mutate Docker later, and a late
result never attaches a network to a session that already fell back.
Session creation has one `SANDBOX_SESSION_CREATE_TIMEOUT_MS` budget (180 seconds
by default) covering provisioning through environment delivery on Docker and
Kubernetes. Request cancellation propagates to outstanding work. Docker failed
creation has a separate 10-second cleanup budget and preserves every workspace
and its organization marker for retry or explicit destroy. Kubernetes failed
creation has a separate 30-second cleanup budget, removes only API-acknowledged
Pod and Secret identities, and preserves workspace PVCs and ambiguous objects.
BuildKit solver parallelism follows the helper's CPU limit rounded down, at
least one, and changes when an idle helper is recreated.

The mirrors enable registry storage deletion so `registry:2` can expire cached
image layers after its seven-day lifetime. Without this setting, its expiry
scheduler forgets failed deletions and the layers remain on disk. A spawner
upgrade replaces older mirrors once no build is running, preserving their cache
volumes. Layers whose expiry already failed are not scheduled again by the
registry; they remain until the organization's stopped caches are reclaimed.

After no agent session may still depend on an organization's cache helpers
(only Docker-enabled agent sessions build), the `SANDBOX_SESSION_MAX_IDLE_MS` window (30
minutes by default) starts. The helpers then stop, the builder pruning its cache
to `SANDBOX_BUILDKITD_IDLE_CACHE` (5 GB by default) first; their network and
volumes remain intact and the next build restarts them. Legacy global cache helpers retire once their remaining sessions drain,
with their cache volumes retained.

An organization's stopped helpers and all four cache volumes are removed after
`SANDBOX_BUILDKITD_CACHE_RETENTION` (14 days by default), or sooner while the
session disk is below `SANDBOX_MIN_FREE_DISK`. This also reclaims layers retained
before mirror expiry was enabled. To make an organization's caches eligible,
let its agent sessions finish and unpin or stop any warm sessions, then leave
the helpers stopped for the retention period. Its next build starts with a
cold cache; session workspaces and package-cache volumes are separate.

Kubernetes sessions use their inner Docker builder. The Kubernetes backend
does not provision these organization helpers or call the Docker CLI during
reconciliation. See the [Kubernetes deployment contract](docs/kubernetes.md).

Deploy the spawner, egress and runtime images from the same release. Before it
attaches an organization build network, the spawner verifies the runtime's
forwarding protection, including when adopting an older runtime image. Generated
Docker containers explicitly disable IPv6 so IPv4-only deployments do not rely
on host IPv6 firewall support. See the [operator environment reference](../../docs/en/self-hosted/configuration/environment-reference.md#sandbox-infrastructure).

## Inner Docker networking

An enabled agent session starts its inner engine on the first ordinary Docker
socket connection and stops it after five idle minutes only when no clients
or active containers need it and all container restart policies are disabled. The image store and workspace survive that
engine stop; the address pool stays fixed until the session container restarts.
Existing container metadata at boot starts the engine immediately for restart
policies. Agents need no setting or new command. See the
[Docker lifecycle](docs/docker-in-container.md#storage--lifecycle).

On Docker and Kubernetes, DinD agent sessions choose an inner private `/16`
against their observed routes, interface addresses, DNS and proxy/gateway
addresses configured at container startup. Hosts supplied later during a turn
are outside that initial observation. An optional `SANDBOX_DIND_INNER_POOL` on
the spawner pins that pool and still rejects known overlap. Automatic selection fails if
discovery is incomplete; an explicit pool can proceed with warnings naming the
unavailable observations. For Kubernetes, choose the override outside the full
Pod, Service and VPC CIDRs, which Pod-local discovery cannot infer. Changing
the pool requires restarting the spawner and recreating existing sessions; a
same-Pod runner restart retains its environment and inner Docker store. The
[Kubernetes contract](docs/kubernetes.md#inner-docker-networking) covers these
operator responsibilities and the egress IPv6 prerequisite.

## Container

`docker-entrypoint.sh` (PID 1, container-level bootstrap — ensures the host
session root exists) `exec`s `entrypoint.sh` (the bun server launch) so signals
reach the server directly. See the script headers for the split rationale.

```bash
# from repo root
docker build -f services/sandbox/Dockerfile .
```

The `agent-light` profile keeps the agent user, coding tools and persistent
workspace without inner Docker or BuildKit.

Reactivating a released session reserves its expected memory growth and checks
disk headroom. Both create and acquire can return 429 `host_memory` or `host_disk`.
Docker's metadata filesystem is observed through its existing `/etc/hostname`
bind when that mount can be verified against the selected daemon. Otherwise,
workspace admission remains active and Docker disk pressure is unavailable.
An explicit `SANDBOX_DOCKER_DATA_ROOT` read-only mount visible at
`SANDBOX_DOCKER_DATA_PATH` takes priority. The CLI generates that optional mount;
raw Compose needs an override. Its source must match DockerRootDir; failed
verification closes admission. Either mount is verified with the daemon once
per process and again only when its free space cannot be read or its kernel
mount entry changes; a failed verification is retried after 30 seconds, the
delay doubling up to 10 minutes while the daemon keeps refuting the mount.
`/health.disks` reports each monitor as ready or
unavailable. Separately mounted volumes or containerd stores need their own
monitoring. These checks do not
enforce per-session disk quotas; those require a quota-capable storage backend.

## Native admission foundation tests

The native admission coordinator is disabled at boot, with no enabling environment
setting and no phase execution tool. The default path performs no native admission
I/O and preserves ordinary session behavior. The internal enabled path shares one
private durable journal across create, acquire and fresh exec; normal quota and
fairness gates remain. Slow Docker startup runs outside the admission queue while
its durable growth hold remains counted. Already-held ordinary growth is reused;
unknown RPC replies stay occupied, and retained output attaches without a fresh POST.

Module and fake-runnerd tests cover this routing, complete daemon inventory,
pressure samples, owned journal paths and restart lineage. An ended predecessor's
metadata record is retained under its immutable ID; only native termination proof
allows a journal's generation to change, preserving every unresolved hold. Healthy
telemetry cannot clear an unknown activity reply. A phase hold never ages out.

Ordinary attempt UUIDs encode the durable journal epoch. Released issued attempts
retain at most 128 recent readbacks; their older IDs cannot be reserved again.
Legacy IDs and every unresolved or phase record remain retained. Reconciliation
uses one complete inventory and one batched snapshot; unchanged observations do
not rewrite the journal. Tests exercise 4097 completed growth cycles through an
instrumented snapshot adapter, real-file reopen and a 20-session scan/write count.
These counts establish bounded work in the fixtures, not native-host latency.

The internal v1 path refuses DinD, build-cache helpers, competing spawners and
unknown writers, Kubernetes, connected devices and remote Docker. It requires an
explicit empty Docker workload allowlist and one verified filesystem shared by the
workspace and Docker metadata. It never changes those capabilities to make a host
eligible. Arbitrary host-root operations and other Docker daemons are outside this
single-daemon boundary. These tests do not establish native topology or telemetry,
and do not make the phase execution feature available.

To exercise the owner with real independent processes, select an already-present
immutable Docker image that contains the workspace's pinned Bun and Docker CLI.
Set `SANDBOX_ADMISSION_TEST_IMAGE` to its full `sha256:` image ID, then run from
the repository root:

```bash
bun run --filter @tale/sandbox test:admission
```

If that image lacks Docker CLI, set `SANDBOX_ADMISSION_TEST_DOCKER_CLI` to an
existing canonical absolute path to a compatible Linux Docker executable. The
fixture mounts that file read-only and compares its SHA-256 inside the runner.
It does not install or download the binary.

This test uses the local `/var/run/docker.sock` and needs Docker administration
access. It starts one 256 MiB, half-CPU runner and one stopped metadata object,
with unique fixture names. It mounts only its captured source closure read-only
in the runner, compares the in-container source hashes, races two independent Bun
processes for ownership, and refuses takeover by a new process while the owner
remains live. This proves the checked-out owner primitive using that image's
binaries; it does not certify the image's baked source. It never pulls or builds
an image and does not use the production authority name.

Docker work has a 75-second operation budget and a separate 15-second cleanup
budget. Filesystem operations are not forcibly interrupted. Cleanup checks
fixture labels and immutable IDs before removal; missing or changed identity
fails the test instead of deleting an unknown object. A passing JSON receipt
records source/image identities and confirms owned objects were removed.
Run it separately from cached unit tests. Exclusive boot topology, fresh host
telemetry, all-writer accounting, restart reconciliation and actual phase
execution require their own native proof before this foundation can be enabled.
