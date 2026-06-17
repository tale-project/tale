---
name: bash
description: Conventions for shell scripts in this repo — strict mode (`set -euo pipefail`), quote every variable, `trap` cleanup, no `eval`, redact secrets before logging, `[[ ]]` tests, loud env-var checks, idempotent/re-entrant scripts, shellcheck-clean. Covers the Docker entrypoint two-file pattern (PID-1 `docker-entrypoint.sh` → `exec entrypoint.sh`). Read before writing or editing a shell script, a Docker entrypoint, or a CI step. Cross-links docker and security.
---

# bash

The contract for `*.sh` in this repo: service entrypoints under [`services/*/`](../../../services/), installers and helpers under [`scripts/`](../../../scripts/), and tooling like [`tools/opengrep/run.sh`](../../../tools/opengrep/run.sh). Container packaging and compose are owned by [`docker`](../docker/SKILL.md); secret-handling and the SAST gate by [`security`](../security/SKILL.md). This skill is the shell _style_ itself.

## The rules

- **Strict mode at the top.** Start `bash` scripts with `set -euo pipefail` (errexit + nounset + pipefail) so a failing command, an unset var, or a broken pipe aborts instead of corrupting state — see [`scripts/install-cli.sh:11`](../../../scripts/install-cli.sh) and [`services/web/docker-entrypoint.sh`](../../../services/web/docker-entrypoint.sh). Many existing container entrypoints use bare `set -e` only because they target `#!/bin/sh` (POSIX, no `pipefail`/`[[ ]]`); for a new `#!/bin/bash` script there's no excuse for less than the full set. Match the shebang to the features you use.
- **Quote every expansion.** `"$VAR"`, `"${VAR:-default}"`, `"$@"`, `"$(cmd)"` — always. Unquoted vars word-split and glob. Build argv as an array and expand it quoted, never as a flat string: `POSTGRES_ARGS+=("-c" "max_connections=${DB_MAX_CONNECTIONS}")` … `exec postgres-entrypoint.sh "$@" "${POSTGRES_ARGS[@]}"` ([`services/db/docker-entrypoint.sh:29,203`](../../../services/db/docker-entrypoint.sh)).
- **Check required env vars and fail loud.** Validate inputs up front, write the reason to `stderr`, exit non-zero: `if [ -z "${DB_PASSWORD:-...}" ]; then echo "ERROR: DB_PASSWORD … must be set" >&2; exit 1; fi` ([`services/db/docker-entrypoint.sh:15`](../../../services/db/docker-entrypoint.sh)). A `set -u` script that reads a missing var also aborts — but an explicit message beats a raw `unbound variable`.
- **Redact secrets before logging.** Never echo a token, password, or a connection URL that embeds one. The db entrypoint pipes its dbmate log through `sed` to mask the URL password before streaming to stderr: `sed -E 's#(postgres(ql)?://[^:]+:)[^@]+@#\1***REDACTED***@#g' "$log" >&2` ([`services/db/docker-entrypoint.sh:146`](../../../services/db/docker-entrypoint.sh)). Apply the same to any captured output you surface. See [`security`](../security/SKILL.md).
- **`trap` for cleanup and signal handling.** Remove temp files on exit and forward signals to children so `docker stop` is clean: `trap 'rm -rf "$tmp_dir"' EXIT` ([`scripts/install-cli.sh:187`](../../../scripts/install-cli.sh)); `trap 'kill -TERM "$TINYPROXY_PID" "$DNSMASQ_PID" 2>/dev/null || true' INT TERM` ([`services/sandbox-egress/entrypoint.sh:81`](../../../services/sandbox-egress/entrypoint.sh)); background-loop guards use `trap 'exit 0' SIGTERM SIGINT` ([`services/db/docker-entrypoint.sh:188`](../../../services/db/docker-entrypoint.sh)).
- **Never `eval`.** It re-parses data as code — an injection hole. Use arrays for dynamic argv (above) instead of building a command string.
- **Prefer `[[ ]]` in bash.** Use `[[ … ]]` for tests and `=~` for regex (it doesn't word-split, supports `&&`/`||`) — e.g. the format hook's `[[ "$FILE_PATH" =~ \.py$ ]]` ([`.claude/hooks/format.sh:17`](../../../.claude/hooks/format.sh)). In `#!/bin/sh` scripts `[[ ]]` is unavailable; use POSIX `[ … ]` and the shebang must be `sh`.
- **Idempotent and re-entrant.** Entrypoints run on _every_ container start, so operations must be safe to repeat: init SQL uses `IF NOT EXISTS` / `CREATE OR REPLACE`, migrations are gated, and the script waits for real readiness (not just a socket) before signalling — `until psql … -c '\q'; do sleep 1; done` then `touch /tmp/.db_ready` ([`services/db/docker-entrypoint.sh:77,189`](../../../services/db/docker-entrypoint.sh)). Transient failures get a bounded retry loop (`for attempt in $(seq 1 30)`), not an infinite spin.
- **shellcheck-clean.** Write so shellcheck passes; where a warning is a deliberate false positive, suppress the _specific_ code inline with a reason — `# shellcheck disable=SC2086 # _dns_flags must word-split` ([`services/sandbox-runtime/entrypoint.sh:240`](../../../services/sandbox-runtime/entrypoint.sh)) — never a blanket disable.
- **`opengrep`/SAST.** Shell is scanned by the SAST gate; a justified finding is silenced inline with `# nosemgrep: <rule-id> -- <why>` ([`services/db/docker-entrypoint.sh:126`](../../../services/db/docker-entrypoint.sh)). See [`security`](../security/SKILL.md).

## The Docker entrypoint two-file pattern

Tale services split container startup into two files so the security boundary is explicit ([`services/sandbox/docker-entrypoint.sh`](../../../services/sandbox/docker-entrypoint.sh) documents it best):

- **`docker-entrypoint.sh`** runs as **PID 1** with whatever privileges the image was launched with. It owns env validation, host-mount perms, capability/privilege setup, and any root-only init — then **`exec`s the app entrypoint** so it replaces itself (no lingering shell PID 1).
- **`entrypoint.sh`** is the app-level launch: it `exec`s the real server (`exec bun src/server.ts`, [`services/sandbox/entrypoint.sh:19`](../../../services/sandbox/entrypoint.sh)) so signals reach the process directly and shutdown is clean. When invoked with args it `exec "$@"` instead, letting ops drop into the image without bypassing setup.

```sh
# docker-entrypoint.sh (PID 1, privileged setup) — services/sandbox/docker-entrypoint.sh
set -e
HOST_SESSION_ROOT="${SANDBOX_HOST_SESSION_ROOT:-/var/lib/tale-sandbox/sessions}"
mkdir -p "$HOST_SESSION_ROOT"
exec /entrypoint.sh "$@"        # hand off; never `&` then wait
```

Always `exec` the final long-running process (don't background it) so it inherits PID semantics and receives `SIGTERM` directly. The Postgres entrypoint is renamed in its Dockerfile precisely so `exec postgres-entrypoint.sh` doesn't re-resolve to the wrapper and loop forever ([`services/db/docker-entrypoint.sh:201`](../../../services/db/docker-entrypoint.sh)).

## Patterns

```bash
# ❌ unquoted, eval, secret leaked, swallowed failure
eval "psql $url -c \"$sql\""
echo "connecting with $DB_PASSWORD"

# ✅ array argv, quoted, redacted, loud failure
: "${DB_PASSWORD:?DB_PASSWORD must be set}"          # fail loud on missing
log="$(mktemp)"; trap 'rm -f "$log"' EXIT
if ! psql -U "$POSTGRES_USER" -d "$DB" -f "$sql" >"$log" 2>&1; then
  sed -E 's#(postgres(ql)?://[^:]+:)[^@]+@#\1***REDACTED***@#g' "$log" >&2
  exit 1
fi
```

## Verify

Run `shellcheck <file>.sh` (the repo expects clean output), then exercise the script — for an entrypoint, bring the container up via [`docker`](../docker/SKILL.md) and confirm it reaches readiness and shuts down cleanly on `docker stop`. See [`verify`](../verify/SKILL.md).
