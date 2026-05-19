#!/bin/sh
# services/sandbox-runtime/entrypoint.sh
#
# Per-call entrypoint inside an ephemeral sandbox container.
#
# Args (from spawner's docker run):
#   $1 = language ('python' | 'node')
#   $2 = path to packages.json (JSON array of pip/npm specs)
#   $3 = path to options.json   ({ allowSdist?: bool, allowInstallScripts?: bool })
#
# Env (set by spawner via --env):
#   HTTPS_PROXY / HTTP_PROXY  -> http://sandbox-egress:3128
#   PIP_CACHE_DIR             -> /cache/pip (per-org named volume)
#   NPM_CONFIG_CACHE          -> /cache/npm
#
# Conventions:
#   - User code at /workspace/code/main.{py,js}
#   - Output files in /workspace/output/
#   - install-report.json at /workspace/install-report.json (audit)
#   - PHASE markers on stdout so the spawner can split install vs run timing.
#
# Exit codes:
#   0   = user code completed successfully
#   64  = install failed (spawner classifies as INSTALL_FAILED / PACKAGE_NOT_FOUND)
#   65  = bad invocation (unknown language / missing args)
#   >0  = user code exit code (RUNTIME_ERROR)

set -e

LANG_NAME="$1"
PACKAGES_FILE="${2:-/workspace/code/packages.json}"
OPTIONS_FILE="${3:-/workspace/code/options.json}"

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

mkdir -p /workspace/output

run_python() {
  PIP_ARGS="--target /workspace/.deps/python --no-progress"
  if [ "$ALLOW_SDIST" != "true" ]; then
    # Block sdist installs by default — closes setup.py ACE vector (R2.7).
    PIP_ARGS="$PIP_ARGS --only-binary=:all:"
  fi
  if [ -n "$PACKAGES_ARGV" ]; then
    eval "uv pip install $PIP_ARGS $PACKAGES_ARGV" \
      > /workspace/install-stdout.log 2> /workspace/install-stderr.log \
      || { tail -c 64000 /workspace/install-stderr.log >&2; exit 64; }
    uv pip list --format=json --python /workspace/.deps/python 2>/dev/null \
      > /workspace/install-report.json || true
  fi
  export PYTHONPATH=/workspace/.deps/python
  echo "PHASE: running"
  exec python3 /workspace/code/main.py
}

run_node() {
  NPM_ARGS="--prefix /workspace/.deps/node --no-audit --no-fund --no-progress --loglevel=error"
  if [ "$ALLOW_INSTALL_SCRIPTS" != "true" ]; then
    # Block lifecycle scripts by default — closes Shai-Hulud-class postinstall ACE (R2.7).
    NPM_ARGS="$NPM_ARGS --ignore-scripts"
  fi
  if [ -n "$PACKAGES_ARGV" ]; then
    mkdir -p /workspace/.deps/node
    (cd /workspace/.deps/node && npm init -y > /dev/null 2>&1) || true
    eval "npm install $NPM_ARGS $PACKAGES_ARGV" \
      > /workspace/install-stdout.log 2> /workspace/install-stderr.log \
      || { tail -c 64000 /workspace/install-stderr.log >&2; exit 64; }
    npm ls --prefix /workspace/.deps/node --json --depth=0 2>/dev/null \
      > /workspace/install-report.json || true
  fi
  export NODE_PATH=/workspace/.deps/node/node_modules
  echo "PHASE: running"
  exec node /workspace/code/main.js
}

case "$LANG_NAME" in
  python) run_python ;;
  node)   run_node ;;
  *)
    echo "sandbox-runtime: unknown language: $LANG_NAME" >&2
    exit 65
    ;;
esac
