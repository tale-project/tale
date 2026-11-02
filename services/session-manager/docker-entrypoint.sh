#!/usr/bin/env bash
set -euo pipefail

DEFAULT_PORT=3004
export PORT="${PORT:-$DEFAULT_PORT}"

# Whether a directory, or one of its parents, is a mount: field 5 of
# /proc/self/mountinfo is where.
on_a_mount() {
  local dir
  dir="$(readlink -f "$1")"
  while [ "$dir" != "/" ]; do
    if awk -v target="$dir" '$5 == target { found = 1 } END { exit !found }' /proc/self/mountinfo; then
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

# What the app keeps is under the data directory (the database with the proxy
# passwords and the secrets, every session's profile) and the Camoufox browser
# it downloads (by default inside it). Say what is wrong in words, before the
# server fails on it with a stack trace.
for dir in "${SESSION_MANAGER_DATA_DIR:-/data}" "${CAMOUFOX_INSTALL_DIR:-}"; do
  [ -n "$dir" ] || continue
  if [ ! -d "$dir" ] && ! mkdir -p "$dir" 2>/dev/null; then
    echo "[session-manager] ERROR: cannot create ${dir} as uid $(id -u)." >&2
    exit 1
  fi
  if [ ! -w "$dir" ]; then
    echo "[session-manager] ERROR: ${dir} is not writable by uid $(id -u) (the app user)." >&2
    echo "[session-manager] Use a named volume (-v session-manager-data:${dir}), or give a bind mount to uid $(id -u): chown $(id -u):$(id -g) <host directory>" >&2
    exit 1
  fi
  # A container's own filesystem goes away with the container, and the browser
  # is a 700 MB download: worth a line, not worth refusing to start.
  if ! on_a_mount "$dir"; then
    echo "[session-manager] WARNING: ${dir} is not on a mounted volume: what is kept there (the sessions and secrets, or the downloaded browser) is lost with this container (docker run -v <volume>:${dir} ...)." >&2
  fi
done

echo "[session-manager] starting on ${SESSION_MANAGER_HOST:-127.0.0.1}:${PORT}"
# exec: the signals tini forwards reach the server, which closes every browser
# gracefully before it exits. `--no-install`: a package that is missing is an
# error, never something bun fetches from the registry at run time.
exec bun --no-install server.ts
