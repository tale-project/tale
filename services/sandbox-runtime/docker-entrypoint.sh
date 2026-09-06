#!/bin/sh
# services/sandbox-runtime/docker-entrypoint.sh
#
# Container-level wrapper for the sandbox runtime. The spawner launches this
# image as a long-lived session container (`daemon`) or a K8s egress sidecar
# (`egress-sidecar`), so the "container init" envelope is intentionally
# minimal:
#
#   - The spawner is the trust boundary; the single positional dispatch arg
#     is the only thing this image reads from argv.
#   - The session workspace is a host bind-mount / PVC at /agent.
#   - This script's only job is to `exec` `entrypoint.sh` with the args
#     preserved so container signals (SIGTERM on stop) reach the daemon.
#
# The two-file split mirrors the Tale convention used by sandbox /
# sandbox-egress / db: docker-entrypoint.sh is the container-level
# envelope and entrypoint.sh holds the app logic.

set -e

exec /entrypoint.sh "$@"
