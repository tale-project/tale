#!/bin/sh
# services/controller/docker-entrypoint.sh
#
# Container-level bootstrap for Controller. Convention used across Tale's
# docker services:
#
#   docker-entrypoint.sh — runs as PID 1 with whatever privileges the image
#                          was launched with. Owns environment checks, host-side
#                          directory perms, and any security setup. Then `exec`s
#                          `entrypoint.sh`.
#
#   entrypoint.sh        — app-level launch. Replaces this process with the
#                          actual server so signals reach it directly and
#                          `docker stop` shuts down cleanly.
#
# The controller is a zero-dependency sidecar that runs Bun as PID 1, so there
# is nothing host-side to fix up here. The envelope exists for fleet
# consistency and as the place to add capability drops / socket checks should
# the privileged surface ever grow.

set -e

exec /entrypoint.sh "$@"
