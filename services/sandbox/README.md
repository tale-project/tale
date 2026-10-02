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
session or answers 429 `host_memory`. At most 12 Docker CLI processes run at
once, each within its own time budget, the wait for a slot included; short
calls (the health probe's `docker version`, the identity and liveness
inspects, the build helper and host memory checks) take a free one of those
or one of 4 more kept for them, and never queue behind long calls. A health
probe that found no slot in time answers unhealthy without caching it. Platform adds an organization's three
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
Observations coalesce and cache for five seconds;
the settings page refreshes every 15 seconds and marks unavailable metrics.

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
holds; the next start empties whatever a restart or crash left there. See
[stop vs destroy](docs/sessions.md#stop-vs-destroy--the-data-preservation-contract).

Docker admission serializes creates through the host's single spawner.
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
sessions build locally.

After no agent session may still depend on an organization's cache helpers
(only agent sessions build), the `SANDBOX_SESSION_MAX_IDLE_MS` window (30
minutes by default) starts. The helpers then stop, the builder pruning its cache
to `SANDBOX_BUILDKITD_IDLE_CACHE` (5 GB by default) first; their network and
volumes remain intact and the next build restarts them. Legacy global cache helpers retire once their remaining sessions drain,
with their cache volumes retained.

Kubernetes sessions use their inner Docker builder. The Kubernetes backend
does not provision these organization helpers or call the Docker CLI during
reconciliation. See the [Kubernetes deployment contract](docs/kubernetes.md).

Deploy the spawner, egress and runtime images from the same release. Before it
attaches an organization build network, the spawner verifies the runtime's
forwarding protection, including when adopting an older runtime image. Generated
Docker containers explicitly disable IPv6 so IPv4-only deployments do not rely
on host IPv6 firewall support. See the [operator environment reference](../../docs/en/self-hosted/configuration/environment-reference.md#sandbox-infrastructure).

## Inner Docker networking

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
