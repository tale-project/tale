#!/bin/sh
# services/sandbox-runtime/docker-entrypoint.sh
#
# Container-level wrapper for the ephemeral sandbox runtime. This image
# is launched once per /v1/execute call by the spawner via `docker run`,
# so the "container init" envelope is intentionally minimal:
#
#   - The spawner is the trust boundary; it has already validated the
#     positional args we receive ($1 language, $2 packages.json, ...).
#   - The user's code lives on a host bind-mount at /agent/code/.
#   - There's no daemon to initialise — this script's only job is to
#     `exec` `entrypoint.sh` with the args preserved so signals (SIGTERM
#     from the spawner's kill on timeout) reach the language process.
#
# The two-file split mirrors the Tale convention used by sandbox /
# sandbox-egress / db: docker-entrypoint.sh is the container-level
# envelope and entrypoint.sh holds the app logic.

set -e

exec /entrypoint.sh "$@"
