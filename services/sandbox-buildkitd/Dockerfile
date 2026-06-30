# Tale Sandbox Shared buildkitd
#
# A single, persistent BuildKit daemon shared by every DinD sandbox session on
# the host. Its content-addressed build cache (/var/lib/buildkit, a persistent
# volume) is reused across sessions automatically — so `docker compose up
# --build` inside one session reuses the layers another session already built,
# instead of every session rebuilding from zero. Sessions point a remote buildx
# builder at it (TALE_BUILDKITD_ENDPOINT); the daemon's internal cache is shared
# with no `--cache-to/--cache-from` flags.
#
# Egress: this container sits on `tale-sandbox-net` (internal-only), so build
# RUN steps have NO direct internet. `--oci-worker-net=host` runs them in this
# container's netns, and docker-entrypoint.sh installs the SAME transparent
# egress as a sandbox session (OUTPUT -> redsocks -> sandbox-egress, with the
# IMDS/RFC1918 fence + DNS via the egress dnsmasq).
#
# Base = DEBIAN, NOT the alpine moby/buildkit image: alpine's musl/libevent
# redsocks accepts the redirect + gets the proxy's CONNECT 200 but then never
# relays data (build egress stalls). The debian redsocks (identical version,
# same nft iptables) relays correctly — proven by the live sandbox sessions,
# which use the same debian-based runtime image. We copy the EXACT buildkit
# static binaries out of the official image so the buildkit version is
# unchanged; only the OS userland around it differs.
#
# REQUIRED: run with --privileged (buildkitd needs mount/namespace ops to run
# builds). See services/sandbox/src/buildkitd.ts (the spawner launches this).

# Pinned tag carries the buildkit binaries we run; the alpine userland is unused.
FROM moby/buildkit:buildx-stable-1 AS buildkit

# Root + --privileged are required: buildkitd needs the mount/namespace ops a
# build performs; the daemon is reachable only on the internal sandbox network
# and build RUN-step egress is fenced through the sandbox-egress proxy by
# docker-entrypoint.sh. Trivy AVD-DS-0002 (root) + AVD-DS-0026 (no HEALTHCHECK,
# the spawner owns liveness) are suppressed by path in .trivyignore.yaml — the
# same single source the other sandbox-tier images use.
FROM debian:bookworm-slim

# The buildkit daemon + buildctl + the bundled OCI runtime, copied verbatim from
# the official image (static Go binaries, so they run on debian unchanged).
COPY --from=buildkit /usr/bin/buildkitd /usr/bin/buildctl /usr/bin/buildkit-runc /usr/local/bin/

# - redsocks:   transparent http-connect tunnel to the egress proxy (the debian
#               build relays data correctly, unlike alpine's)
# - iptables:   the OUTPUT redirect + IMDS fence
# - iproute2:   `ip route` (the --internal netns has no default route)
# - util-linux: `setpriv` to drop redsocks to a dedicated uid (the OUTPUT-path
#               owner-match loop-breaker needs a stable non-root owner)
# - tini:       reap redsocks + the runc/build shims buildkitd forks (PID 1)
# - ca-certificates: registry TLS trust for image pulls
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      redsocks iptables iproute2 util-linux tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Shipped read-only base. The live --config (/etc/buildkit/buildkitd.toml) is
# regenerated from this on every start by docker-entrypoint.sh, so a restart
# never inherits a stale dynamic [dns]/[registry] block (the egress IP can change
# across sandbox-egress recreation, and the daemon restarts independently).
COPY services/sandbox-buildkitd/buildkitd.toml /etc/buildkit/buildkitd.base.toml
COPY services/sandbox-buildkitd/docker-entrypoint.sh /docker-entrypoint.sh
COPY services/sandbox-buildkitd/entrypoint.sh /entrypoint.sh
RUN chmod +x /docker-entrypoint.sh /entrypoint.sh

# gRPC endpoint sessions connect their remote buildx builder to (on the internal
# sandbox network only — never published to the host).
EXPOSE 1234

ENTRYPOINT ["/docker-entrypoint.sh"]
