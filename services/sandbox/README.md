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

`GET /v1/capacity?organizationId=<id>` uses the same HMAC authentication as
session operations. It returns aggregate runtime slot use, configured admission
ceilings, and only the requesting organization's session ids. Platform exposes
aggregates to admins and developers; workspace details remain admin-only.

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
running. The capacity inventory includes that container until it stops.

## Organization build caches

Each organization has one privileged BuildKit container, three unprivileged
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

After no session may still depend on an organization's cache helpers, the
`SANDBOX_SESSION_MAX_IDLE_MS` window (30 minutes by default) starts. The helpers
then stop; their network and volumes remain intact and the next build restarts
them. Legacy global cache helpers retire once their remaining sessions drain,
with their cache volumes retained.

Deploy the spawner, egress and runtime images from the same release. Before it
attaches an organization build network, the spawner verifies the runtime's
forwarding protection, including when adopting an older runtime image. Generated
Docker containers explicitly disable IPv6 so IPv4-only deployments do not rely
on host IPv6 firewall support. See the [operator environment reference](../../docs/en/self-hosted/configuration/environment-reference.md#sandbox-infrastructure).

## Container

`docker-entrypoint.sh` (PID 1, container-level bootstrap — ensures the host
session root exists) `exec`s `entrypoint.sh` (the bun server launch) so signals
reach the server directly. See the script headers for the split rationale.

```bash
# from repo root
docker build -f services/sandbox/Dockerfile .
```
