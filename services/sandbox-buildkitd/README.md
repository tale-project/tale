# Tale Sandbox BuildKit cache

Each organization gets a persistent BuildKit daemon that its DinD sessions can
reuse. Build layers and registry downloads stay within that organization, while
the session's own Docker image store remains disposable.

## Enable caching for DinD sessions

The Docker spawner provisions the cache lazily when an agent session needs it.
`SANDBOX_DOCKER_BUILD_CACHE` defaults to the DinD setting; set it to `false` to
use only each session's local builder. This integration is implemented by the
Docker backend, not the Kubernetes backend.

The spawner creates one daemon, one private internal bridge, and persistent
cache volumes per organization. Container/network names include a bounded hash
of the case-sensitive organization ID; full `tale.org` labels are checked before
reuse. A same-name resource with missing or different ownership is refused.

Each organization also gets a separate `registry:2` pull-through mirror for
`docker.io`, `ghcr.io`, and `quay.io`. The daemon and mirrors join only their
organization's bridge, without published ports. Sessions also retain the shared
control network for runnerd, Platform, and the model gateway.

## Keep build traffic isolated

The existing egress proxy joins each private bridge with the network-local alias
`tale-buildkit-egress`. The spawner verifies or installs a forwarding deny rule
before attaching it, so the proxy cannot route packets between organizations.
The runtime blocks unsolicited forwarding through a session's outer interfaces
after starting the inner Docker daemon; replies to nested containers remain
allowed.

Build RUN steps use the builder's network namespace. Its entrypoint installs
transparent egress through the proxy and pins DNS to that proxy's current IP.
Provisioning and adoption check for an absent or stale egress setup and recreate
the affected builder with the same cache volume.

The runtime selects a buildx builder whose name is derived from the full
`TALE_BUILDKITD_ENDPOINT`, so a resumed workspace cannot reuse the old global
`tale-shared` builder by accident. Failed builder setup selects the local
`default` builder. A bare remote `docker build` needs `--load` to make its result
available in the session's inner Docker engine.

## Upgrade from the global cache

New sessions start with organization-specific caches. Existing global volumes
and buildx configuration are retained and are never imported into an
organization's cache.

The spawner stops only the known global helper containers carrying the legacy
`tale.buildkitd=1` ownership label, and only after no running, paused, restarting,
or starting session still depends on the global endpoint. It checks during
provisioning and maintenance. It does not remove their containers or volumes.

Pinned legacy sessions must finish their work and stop before the old helpers
can retire. Until that drain completes, the old global service remains reachable
on the shared network; deployment of the new code alone does not complete the
isolation transition. Helpers with foreign or missing ownership labels are left
for the operator to review.

## Runtime requirements

The builder runs privileged for its mount and namespace operations. Its private
bridge and the egress firewall are required boundaries; the API has no separate
client authentication. The GC policy in [buildkitd.toml](buildkitd.toml) caps
each organization's cache at 20 GB (least recently used records go first) and,
while the builder runs, prunes it further while the disk it shares with every
session has less than 5% free, but never below 2 GB: each builder prunes its
own cache by the whole shortfall, so without that floor a disk other data
filled would wipe every building organization's cache. Cache mounts, build
contexts and git checkouts unused for two days go first. GC runs at start and
about a minute after a build. Registry mirror storage is separate from the
BuildKit cache.

GC runs only in a running builder, and the spawner stops an organization's
helpers once no agent session of it has run for the idle window. Right before
that stop it prunes the builder's cache down to `SANDBOX_BUILDKITD_IDLE_CACHE`
(5 GB by default) with `buildctl prune --all --keep-storage`, least recently
used records first; the prune is bounded to two minutes, and one that fails is
logged and the stop goes on. A session create of the organization that arrives
meanwhile cuts the prune short, and the helpers keep running for it. Stopped
caches add up to the idle budget times the number of organizations, so they
are kept only so long: once an organization's builder has been stopped for
`SANDBOX_BUILDKITD_CACHE_RETENTION` (14 days by default; `off` keeps them) and
no session of it may build, the idle sweep removes its helpers, network and
cache volumes the way its teardown through `DELETE /v1/organizations/:id`
does, and its next build starts cold. What stays open: no budget reacts to the
free disk itself.

The builder is shared by all of its organization's agent sessions and runs
under their CPU limit and twice their memory limit (its RUN steps execute
there, outside every session's cgroup), or `SANDBOX_BUILDKITD_CPUS` and
`SANDBOX_BUILDKITD_MEMORY`; each mirror runs under 512 MB and one CPU, and
every helper's logs are capped like a session's. Each helper carries a stamp of
its image reference and bounds, and the spawner compares the image it runs
with the one its reference names now (a release re-tags `:latest` in place).
A helper launched otherwise gets its CPU and process bounds in place at once;
the builder and its mirrors are recreated on the current image and bounds,
memory included, once no build is running, keeping their volumes. A memory
cut is never applied to a busy helper: on cgroup v2 it OOM-kills the build.

Keep Docker's outer network allocation within RFC1918 and separate from the
inner Docker pool. Current runtimes select a non-overlapping private `/16` at
startup; the spawner also reserves `172.31.0.0/16` when allocating build bridges
for compatibility with older runtime images. See the
[inner networking contract](../sandbox/README.md#inner-docker-networking) before
pinning `SANDBOX_DIND_INNER_POOL`. The proxy accepts clients
from `10.0.0.0/8`, `172.16.0.0/12`, and `192.168.0.0/16`; private build bridges
must fit entirely inside one of those ranges. A public or conflicting bridge is
refused and the session uses its local builder; the spawner preserves the
network for operator review.

Resource creation, refusal, reuse, and guarded legacy retirement are covered by
[the provisioning tests](../sandbox/src/buildkit-resources.test.ts).
