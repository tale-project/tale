#!/bin/sh
# services/sandbox/docker-entrypoint.sh
#
# Container-level bootstrap for the Tale sandbox spawner. Mirrors the
# two-file split used by other Tale services:
#
#   docker-entrypoint.sh — runs as PID 1 with whatever privileges the
#                          image was launched with. Owns environment
#                          checks, host-side directory perms, and any
#                          security setup (capability drops, etc).
#                          Then `exec`s `entrypoint.sh`.
#
#   entrypoint.sh        — app-level launch. Replaces this process with
#                          the actual bun server so signals reach the
#                          server directly and `docker stop` shuts down
#                          cleanly.
#
# The two-file split makes the security boundary explicit and lets the
# Dockerfile chain in extra init (e.g. a `docker-compose entrypoint:` or
# CI smoke wrapper) without rewriting the app launch path.

set -e

# The spawner needs write access to the host session root (mounted at
# /var/lib/tale-sandbox/sessions by the compose generator). Container UID
# matches the host's docker-engine UID (root inside; root maps to host
# root for the mount), so a `mkdir -p` here is enough to recover from a
# fresh volume that the kernel created with default perms.
HOST_SESSION_ROOT="${SANDBOX_HOST_SESSION_ROOT:-/var/lib/tale-sandbox/sessions}"
mkdir -p "$HOST_SESSION_ROOT"

exec /entrypoint.sh "$@"
