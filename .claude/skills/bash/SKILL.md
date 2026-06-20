---
name: bash
description: Conventions for shell scripts in this repo — strict mode (`set -euo pipefail`), quote every expansion, array argv, `trap` cleanup/signals, no `eval`, redact secrets before logging, `[[ ]]` tests, loud env-var checks, idempotent/re-entrant entrypoints, shellcheck- and opengrep-clean. Owns the Docker entrypoint two-file pattern (PID-1 `docker-entrypoint.sh` → `exec entrypoint.sh`). Read before writing or editing a shell script, a Docker entrypoint, or a CI step.
---

# bash

The contract for `*.sh` here: service entrypoints under [`services/*/`](../../../services/),
installers/helpers under [`scripts/`](../../../scripts/), and tooling like
[`tools/opengrep/run.sh`](../../../tools/opengrep/run.sh). Container packaging and compose are
[`docker`](../docker/SKILL.md); secret-handling and the SAST gate are
[`security`](../security/SKILL.md). This skill is the shell _style_ itself.

## When this applies

Writing or editing any `.sh` — a service entrypoint, an installer, a `tools/` helper, or a CI step.
The Docker entrypoint two-file split is owned here and referenced by [`docker`](../docker/SKILL.md).

## The rules

- **Strict mode at the top.** Start `#!/bin/bash` scripts with `set -euo pipefail` so a failing
  command, an unset var, or a broken pipe aborts instead of corrupting state
  ([`scripts/install-cli.sh:10`](../../../scripts/install-cli.sh),
  [`services/web/docker-entrypoint.sh:2`](../../../services/web/docker-entrypoint.sh)). Many container
  entrypoints use bare `set -e` only because they're `#!/bin/sh` (POSIX — no `pipefail`/`[[ ]]`); a
  new `#!/bin/bash` script has no excuse for less. Match the shebang to the features you use.
- **Quote every expansion** — `"$VAR"`, `"${VAR:-default}"`, `"$@"`, `"$(cmd)"`. Unquoted vars
  word-split and glob. Build argv as an **array** and expand it quoted, never as a flat string:
  `POSTGRES_ARGS+=("-c" "max_connections=${DB_MAX_CONNECTIONS}")` … `exec postgres-entrypoint.sh "$@"
"${POSTGRES_ARGS[@]}"` ([`services/db/docker-entrypoint.sh:29,232`](../../../services/db/docker-entrypoint.sh)).
- **Check required env vars and fail loud** — validate up front, reason to `stderr`, exit non-zero:
  `if [ -z "${DB_PASSWORD:-${POSTGRES_PASSWORD:-}}" ]; then echo "ERROR: …" >&2; exit 1; fi`
  ([`services/db/docker-entrypoint.sh:15`](../../../services/db/docker-entrypoint.sh)). A `set -u`
  script also aborts on a missing var, but an explicit message beats a raw `unbound variable`.
- **Redact secrets before logging.** Never echo a token, password, or a connection URL embedding one.
  The db entrypoint masks the URL password before streaming dbmate's log to stderr:
  `sed -E 's#(postgres(ql)?://[^:]+:)[^@]+@#\1***REDACTED***@#g' "$log" >&2`
  ([`services/db/docker-entrypoint.sh:155`](../../../services/db/docker-entrypoint.sh)). Apply the same
  to any captured output you surface. See [`security`](../security/SKILL.md).
- **`trap` for cleanup and signals** — remove temp files on exit, forward signals to children so
  `docker stop` is clean: `trap 'rm -rf "$tmp_dir"' EXIT`
  ([`scripts/install-cli.sh:187`](../../../scripts/install-cli.sh)); `trap 'kill -TERM
"$TINYPROXY_PID" "$DNSMASQ_PID" 2>/dev/null || true' INT TERM`
  ([`services/sandbox-egress/entrypoint.sh:81`](../../../services/sandbox-egress/entrypoint.sh));
  background-loop guards use `trap 'exit 0' SIGTERM SIGINT`
  ([`services/db/docker-entrypoint.sh:209`](../../../services/db/docker-entrypoint.sh)).
- **Never `eval`.** It re-parses data as code — an injection hole. Use arrays for dynamic argv instead.
- **Prefer `[[ ]]` in bash** for tests, `=~` for regex (no word-split, supports `&&`/`||`) — the
  format hook's `[[ "$FILE_PATH" =~ \.py$ ]]`
  ([`.claude/hooks/format.sh:17`](../../../.claude/hooks/format.sh)). In `#!/bin/sh` scripts use POSIX
  `[ … ]`, and the shebang must be `sh`.
- **Idempotent and re-entrant.** Entrypoints run on _every_ container start, so operations must be
  safe to repeat: init SQL uses `IF NOT EXISTS` / `CREATE OR REPLACE`, migrations are gated, and the
  script waits for real readiness before signalling — `until pg_isready … ; do sleep 1; done` then
  `touch /tmp/.db_ready` ([`services/db/docker-entrypoint.sh:210,223`](../../../services/db/docker-entrypoint.sh)).
  Transient failures get a bounded retry (`for attempt in $(seq 1 30)`), never an infinite spin.
- **shellcheck- and opengrep-clean.** Write so shellcheck passes; silence a deliberate false positive
  with the _specific_ code inline plus a reason — `# shellcheck disable=SC2086 # _dns_flags must
word-split` ([`services/sandbox-runtime/entrypoint.sh:394`](../../../services/sandbox-runtime/entrypoint.sh))
  — never a blanket disable. Shell is also SAST-scanned; a justified finding is silenced inline with
  `# nosemgrep: <rule-id> -- <why>`
  ([`services/db/docker-entrypoint.sh:135`](../../../services/db/docker-entrypoint.sh)).

## The Docker entrypoint two-file pattern

Tale services split container startup into two files so the security boundary is explicit
([`services/sandbox/docker-entrypoint.sh`](../../../services/sandbox/docker-entrypoint.sh) documents it
best):

- **`docker-entrypoint.sh`** runs as **PID 1** with the image's launch privileges. It owns env
  validation, host-mount perms, capability/privilege setup, and any root-only init — then **`exec`s
  the app entrypoint** so it replaces itself (no lingering shell PID 1).
- **`entrypoint.sh`** is the app-level launch: it `exec`s the real server (`exec bun src/server.ts`,
  [`services/sandbox/entrypoint.sh:19`](../../../services/sandbox/entrypoint.sh)) so signals reach the
  process directly and shutdown is clean. Given args it `exec "$@"` instead, letting ops drop into the
  image without bypassing setup.

```sh
# docker-entrypoint.sh (PID 1, privileged setup) — services/sandbox/docker-entrypoint.sh
set -e
HOST_SESSION_ROOT="${SANDBOX_HOST_SESSION_ROOT:-/var/lib/tale-sandbox/sessions}"
mkdir -p "$HOST_SESSION_ROOT"
exec /entrypoint.sh "$@"        # hand off; never `&` then wait
```

Always `exec` the final long-running process (don't background it) so it inherits PID semantics and
receives `SIGTERM` directly. The Postgres entrypoint is renamed in its Dockerfile precisely so
`exec postgres-entrypoint.sh` doesn't re-resolve to the wrapper and loop forever
([`services/db/docker-entrypoint.sh:232`](../../../services/db/docker-entrypoint.sh)).

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

Run `shellcheck <file>.sh` (the repo expects clean output), then exercise the script — for an
entrypoint, bring the container up via [`docker`](../docker/SKILL.md) and confirm it reaches readiness
and shuts down cleanly on `docker stop`. See [`verify`](../verify/SKILL.md).
