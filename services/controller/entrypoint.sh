#!/bin/sh
# services/controller/entrypoint.sh
#
# App-level launch for Controller. `docker-entrypoint.sh` runs first and
# `exec`s us with whatever args the Dockerfile CMD (or a `docker run … COMMAND`
# override) passed in. The `exec` keeps Bun as PID 1 so SIGTERM from
# `docker stop` reaches the server directly and it shuts down cleanly.

set -e

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

exec bun src/server.ts
