#!/bin/sh
# services/sandbox-runtime/entrypoint.sh
#
# Per-call entrypoint inside an ephemeral sandbox container.
#
# Args (from spawner's docker run):
#   $1 = language ('python' | 'node' | 'polyglot')
#   $2 = path to packages.json (JSON array of pip/npm specs).
#        Polyglot mode IGNORES this file and reads
#        /workspace/code/packages-python.json + /workspace/code/packages-node.json
#        instead (either may be missing or empty).
#   $3 = path to options.json   ({ allowSdist?: bool, allowInstallScripts?: bool })
#   $4 = entry path: either a relative POSIX path resolved under
#        /workspace/code/, or an absolute path under /workspace/code/ or
#        /workspace/.tale/ (the latter is the spawner-generated multi-step
#        wrapper). Anything else exits 65.
#
# Env (set by spawner via --env):
#   HTTPS_PROXY / HTTP_PROXY  -> http://sandbox-egress:3128
#   PIP_CACHE_DIR             -> /cache/pip (per-org named volume)
#   NPM_CONFIG_CACHE          -> /cache/npm
#
# Conventions:
#   - User code at /workspace/code/<path> — staged 1:1 from the spawner's
#     `files[]`. The runtime exec()s the file at $4; no synthetic mirror.
#   - Multi-step wrapper (when used) at /workspace/.tale/runner.{py,js} —
#     dotfile segment is unreachable from user-supplied paths, so user files
#     can be named anything (including main.py).
#   - Output files in /workspace/output/
#   - install-stderr.log at /workspace/install-stderr.log — captured stderr
#     from the package install step, tailed to container stderr on failure
#     (exit 64) so the spawner can surface it. Nothing reads stdout: install
#     stdout flows directly to the container stdout for live streaming.
#   - PHASE markers on stdout so the spawner can split install vs run timing.
#
# Exit codes:
#   0   = user code completed successfully
#   64  = install failed (spawner classifies as INSTALL_FAILED / PACKAGE_NOT_FOUND)
#   65  = bad invocation (unknown language / missing args / bad entry path)
#   >0  = user code exit code (RUNTIME_ERROR)

set -e

LANG_NAME="$1"
PACKAGES_FILE="${2:-/workspace/code/packages.json}"
OPTIONS_FILE="${3:-/workspace/code/options.json}"
ENTRY_ARG="${4:?sandbox-runtime: missing entry path (positional arg 4)}"

# Resolve entry path. Accept either an absolute path under one of the two
# allowed roots, or a relative path interpreted under /workspace/code/.
case "$ENTRY_ARG" in
  /workspace/.tale/*|/workspace/code/*)
    ENTRY_FILE="$ENTRY_ARG"
    ;;
  /*)
    echo "sandbox-runtime: entry path outside /workspace: $ENTRY_ARG" >&2
    exit 65
    ;;
  *)
    ENTRY_FILE="/workspace/code/$ENTRY_ARG"
    ;;
esac
case "$ENTRY_FILE" in
  *..*)
    echo "sandbox-runtime: traversal segment in entry path: $ENTRY_ARG" >&2
    exit 65
    ;;
esac

# Workspace is delivered via host bind-mount (spawner.ts:stageWorkspace
# writes /var/lib/tale-sandbox/sessions/<id>/{code,input,output}/ on the
# host and mounts it 1:1 at /workspace inside this container). The mkdir
# below is defensive — the bind-mount source already contains these dirs
# when the spawner is happy, but a malformed call should still see
# usable /workspace/output to write into.
mkdir -p /workspace/code /workspace/input /workspace/output

echo "PHASE: installing"

ALLOW_SDIST="false"
ALLOW_INSTALL_SCRIPTS="false"
if [ -f "$OPTIONS_FILE" ]; then
  ALLOW_SDIST=$(jq -r '.allowSdist // false' "$OPTIONS_FILE" 2>/dev/null || echo false)
  ALLOW_INSTALL_SCRIPTS=$(jq -r '.allowInstallScripts // false' "$OPTIONS_FILE" 2>/dev/null || echo false)
fi

PACKAGES_ARGV=""
if [ -f "$PACKAGES_FILE" ]; then
  # jq @sh escapes each package spec safely for shell expansion. The PACKAGES_FILE
  # was written by the spawner (a trusted, typed pipeline) — not user shell input.
  PACKAGES_ARGV=$(jq -r '. | map(@sh) | join(" ")' "$PACKAGES_FILE" 2>/dev/null || echo "")
fi

# Polyglot extras — each bucket lives in its own file written by the
# spawner. Either may be absent or carry an empty array, in which case
# the matching install pass is skipped.
PY_PACKAGES_FILE="/workspace/code/packages-python.json"
NODE_PACKAGES_FILE="/workspace/code/packages-node.json"
PY_PACKAGES_ARGV=""
NODE_PACKAGES_ARGV=""
if [ -f "$PY_PACKAGES_FILE" ]; then
  PY_PACKAGES_ARGV=$(jq -r '. | map(@sh) | join(" ")' "$PY_PACKAGES_FILE" 2>/dev/null || echo "")
fi
if [ -f "$NODE_PACKAGES_FILE" ]; then
  NODE_PACKAGES_ARGV=$(jq -r '. | map(@sh) | join(" ")' "$NODE_PACKAGES_FILE" 2>/dev/null || echo "")
fi

mkdir -p /workspace/output

# Shared pip install. Used by both single-language Python runs and by the
# polyglot bucket. Caller passes `$1`: the @sh-escaped argv string to install.
install_python() {
  PIP_ARGS="--target /workspace/.deps/python --no-progress"
  if [ "$ALLOW_SDIST" != "true" ]; then
    PIP_ARGS="$PIP_ARGS --only-binary=:all:"
  fi
  if [ -n "$1" ]; then
    eval "uv pip install $PIP_ARGS $1" \
      2> /workspace/install-stderr.log \
      || { tail -c 64000 /workspace/install-stderr.log >&2; exit 64; }
  fi
}

# Shared npm install. Same contract as install_python.
install_node() {
  NPM_ARGS="--prefix /workspace/.deps/node --no-audit --no-fund --no-progress --loglevel=error"
  if [ "$ALLOW_INSTALL_SCRIPTS" != "true" ]; then
    NPM_ARGS="$NPM_ARGS --ignore-scripts"
  fi
  if [ -n "$1" ]; then
    mkdir -p /workspace/.deps/node
    (cd /workspace/.deps/node && npm init -y > /dev/null 2> /workspace/install-stderr.log) \
      || { tail -c 64000 /workspace/install-stderr.log >&2; exit 64; }
    eval "npm install $NPM_ARGS $1" \
      2> /workspace/install-stderr.log \
      || { tail -c 64000 /workspace/install-stderr.log >&2; exit 64; }
  fi
}

run_python() {
  PIP_ARGS="--target /workspace/.deps/python --no-progress"
  if [ "$ALLOW_SDIST" != "true" ]; then
    # Block sdist installs by default — closes setup.py ACE vector (R2.7).
    PIP_ARGS="$PIP_ARGS --only-binary=:all:"
  fi
  if [ -n "$PACKAGES_ARGV" ]; then
    # Install stdout flows through to the container stdout so the spawner can
    # surface progress live; stderr is captured to a file and tailed back on
    # failure (exit 64). Do NOT redirect stderr to /dev/null — that would
    # hide the only diagnostic on a broken install.
    eval "uv pip install $PIP_ARGS $PACKAGES_ARGV" \
      2> /workspace/install-stderr.log \
      || { tail -c 64000 /workspace/install-stderr.log >&2; exit 64; }
  fi
  export PYTHONPATH=/workspace/.deps/python
  echo "PHASE: running"
  exec python3 "$ENTRY_FILE"
}

run_node() {
  NPM_ARGS="--prefix /workspace/.deps/node --no-audit --no-fund --no-progress --loglevel=error"
  if [ "$ALLOW_INSTALL_SCRIPTS" != "true" ]; then
    # Block lifecycle scripts by default — closes Shai-Hulud-class postinstall ACE (R2.7).
    NPM_ARGS="$NPM_ARGS --ignore-scripts"
  fi
  if [ -n "$PACKAGES_ARGV" ]; then
    mkdir -p /workspace/.deps/node
    # `npm init -y`'s only side effect is the package.json scaffold; its
    # output is noise but its stderr is the only signal if (e.g.) the dir
    # isn't writable. Capture stderr so a real failure is recoverable.
    (cd /workspace/.deps/node && npm init -y > /dev/null 2> /workspace/install-stderr.log) \
      || { tail -c 64000 /workspace/install-stderr.log >&2; exit 64; }
    # Same pattern as run_python: stdout streams through, stderr is captured
    # for failure-path harvest.
    eval "npm install $NPM_ARGS $PACKAGES_ARGV" \
      2> /workspace/install-stderr.log \
      || { tail -c 64000 /workspace/install-stderr.log >&2; exit 64; }
  fi
  export NODE_PATH=/workspace/.deps/node/node_modules
  echo "PHASE: running"
  exec node "$ENTRY_FILE"
}

run_polyglot() {
  # Polyglot mode: install both buckets when present, export both
  # interpreter resolution paths, then exec the spawner-generated
  # Python dispatcher (which subprocesses python3 / node per step).
  install_python "$PY_PACKAGES_ARGV"
  install_node "$NODE_PACKAGES_ARGV"
  export PYTHONPATH=/workspace/.deps/python
  export NODE_PATH=/workspace/.deps/node/node_modules
  echo "PHASE: running"
  exec python3 "$ENTRY_FILE"
}

case "$LANG_NAME" in
  python)   run_python ;;
  node)     run_node ;;
  polyglot) run_polyglot ;;
  *)
    echo "sandbox-runtime: unknown language: $LANG_NAME" >&2
    exit 65
    ;;
esac
