#!/bin/sh
# services/sandbox-buildkitd/entrypoint.sh
#
# App-level launch for the shared sandbox buildkitd. docker-entrypoint.sh runs
# first and installs the transparent-egress redirect; we exec buildkitd.
#
# tini is PID 1 (-g forwards signals to the whole process group) so the runc /
# build executor shims buildkitd forks — and the backgrounded redsocks — are
# reaped instead of zombified. The gRPC listen addresses + host worker net + GC
# policy all live in /etc/buildkit/buildkitd.toml.

set -eu

echo "[sandbox-buildkitd] starting buildkitd (host worker net, fenced egress, persistent cache at /var/lib/buildkit)"
exec tini -g -- buildkitd --config /etc/buildkit/buildkitd.toml
