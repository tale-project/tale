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
client authentication. Cache size is bounded by the GC policy in
[buildkitd.toml](buildkitd.toml), per organization. Registry mirror storage is
separate from the BuildKit cache.

Keep Docker's outer network allocation within RFC1918 and separate from the
runtime's reserved `172.31.0.0/16` inner Docker pool. The proxy accepts clients
from `10.0.0.0/8`, `172.16.0.0/12`, and `192.168.0.0/16`; private build bridges
must fit entirely inside one of those ranges. A public or conflicting bridge is
refused and the session uses its local builder; the spawner preserves the
network for operator review.

Resource creation, refusal, reuse, and guarded legacy retirement are covered by
[the provisioning tests](../sandbox/src/buildkit-resources.test.ts).
