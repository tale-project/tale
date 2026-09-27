#!/bin/sh
# services/sandbox/entrypoint.sh
#
# App-level launch for the Tale sandbox spawner. `docker-entrypoint.sh`
# runs first and `exec`s us with whatever args the Dockerfile CMD (or a
# `docker run … COMMAND` override) passed in.
#
# When invoked without args, run the bun server. With args, `exec` them
# as-is — lets ops drop into the image (e.g. `docker run --entrypoint
# /docker-entrypoint.sh sandbox:latest sh`) without bypassing the
# container-level setup the docker-entrypoint does.

set -e

# `device-apply <config.json> [--version <release>]` lays out a connected
# device's containers (src/devices/apply-cli.ts) — run by `tale sandbox
# connect` and by a device's own spawner when it follows a server update.
if [ "${1:-}" = "device-apply" ]; then
  shift
  exec bun src/devices/apply-cli.ts "$@"
fi

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

exec bun src/server.ts
