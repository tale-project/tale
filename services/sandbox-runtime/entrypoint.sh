#!/bin/sh
# services/sandbox-runtime/entrypoint.sh
#
# Per-call entrypoint inside an ephemeral sandbox container.
#
# Args (from spawner's docker run):
#   $1 = language ('python' | 'node' | 'bash' | 'polyglot')
#   $2 = path to packages.json (JSON array of pip/npm specs).
#        Polyglot mode IGNORES this file and reads
#        /workspace/code/packages-python.json + /workspace/code/packages-node.json
#        instead (either may be missing or empty).
#   $3 = path to options.json   (currently unused — kept for wire-shape stability)
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
# $3 (options.json path) is reserved for future flags; currently unused.
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
# usable /workspace/output to write into. The `.deps/{python,node}` and
# `.home` dirs back the install env exports below, so any step (python,
# node, bash) can run `pip install` / `npm install` and have it land in
# a writable, on-PYTHONPATH/NODE_PATH location.
mkdir -p \
  /workspace/code \
  /workspace/input \
  /workspace/output \
  /workspace/.deps/python \
  /workspace/.deps/node \
  /workspace/.home \
  /workspace/.tmp

# Install env exported BEFORE language routing so every step language
# (python, node, bash) inherits the same writable paths. The container
# is the security boundary; install-time guards (--only-binary,
# --ignore-scripts) added nothing on top of cap-drop=ALL + read-only
# root + nobody user + egress allowlist, so they're gone.
export HOME=/workspace/.home
# /tmp is a 128 MB tmpfs; pip/npm unpack big dep trees (e.g. markitdown[pptx]
# pulls python-pptx + pdfminer + magika) and blow it out with ENOSPC. Park the
# temp dir on the bind-mounted workspace where there's real disk.
export TMPDIR=/workspace/.tmp
export PIP_TARGET=/workspace/.deps/python
export PYTHONPATH=/workspace/.deps/python${PYTHONPATH:+:$PYTHONPATH}
export PIP_DISABLE_PIP_VERSION_CHECK=1
export NPM_CONFIG_PREFIX=/workspace/.deps/node
export NODE_PATH=/workspace/.deps/node/lib/node_modules
# Console scripts from both ecosystems on PATH: pip --target installs
# entry-point shims into $PIP_TARGET/bin, npm -g installs into
# $NPM_CONFIG_PREFIX/bin. Put them ahead of system bins so installed
# tools (markitdown, prettier, etc.) resolve directly.
export PATH=/workspace/.deps/python/bin:/workspace/.deps/node/bin:$PATH

echo "PHASE: installing"

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

# Shared pip install. Used by both single-language Python runs and by the
# polyglot bucket. Caller passes `$1`: the @sh-escaped argv string to install.
# Install target / PYTHONPATH already wired via env at the top of this script;
# user code (any language step) can also call `pip install foo` inline and it
# lands in the same place.
install_python() {
  if [ -n "$1" ]; then
    # `uv pip install` refuses to touch system site-packages without --target
    # or --system (PIP_TARGET env is a regular-pip thing it doesn't read), so
    # the flag is explicit. Inline `python -m pip install foo` from user code
    # picks up PIP_TARGET via the env export above — both paths land in the
    # same dir.
    #
    # Install stdout flows through to the container stdout so the spawner can
    # surface progress live; stderr is captured to a file and tailed back on
    # failure (exit 64). Do NOT redirect stderr to /dev/null — that would
    # hide the only diagnostic on a broken install.
    eval "uv pip install --target $PIP_TARGET --no-progress $1" \
      2> /workspace/install-stderr.log \
      || { tail -c 64000 /workspace/install-stderr.log >&2; exit 64; }
  fi
}

# Shared npm install. Same contract as install_python. Uses `-g` so packages
# land at $NPM_CONFIG_PREFIX/lib/node_modules — which NODE_PATH points at —
# matching where inline `npm install -g <pkg>` from user code also lands.
install_node() {
  if [ -n "$1" ]; then
    eval "npm install -g --no-audit --no-fund --no-progress --loglevel=error $1" \
      2> /workspace/install-stderr.log \
      || { tail -c 64000 /workspace/install-stderr.log >&2; exit 64; }
  fi
}

run_python() {
  install_python "$PACKAGES_ARGV"
  echo "PHASE: running"
  exec python3 "$ENTRY_FILE"
}

run_node() {
  install_node "$PACKAGES_ARGV"
  echo "PHASE: running"
  exec node "$ENTRY_FILE"
}

run_bash() {
  # No upfront `packages`-param install phase for bash — scripts install on
  # demand via the same env every other language step inherits (PIP_TARGET,
  # NPM_CONFIG_PREFIX, etc.). Invocation is argv-only: `exec bash <path>` —
  # never `bash -c` or `eval`, so the validated entry path is not subject
  # to shell expansion.
  echo "PHASE: running"
  exec bash "$ENTRY_FILE"
}

run_polyglot() {
  # Polyglot mode: install both buckets when present, then exec the
  # spawner-generated Python dispatcher (which subprocesses python3 / node
  # per step). PYTHONPATH / NODE_PATH already exported at the top of the
  # script, so subprocesses inherit them.
  install_python "$PY_PACKAGES_ARGV"
  install_node "$NODE_PACKAGES_ARGV"
  echo "PHASE: running"
  exec python3 "$ENTRY_FILE"
}

case "$LANG_NAME" in
  python)   run_python ;;
  node)     run_node ;;
  bash)     run_bash ;;
  polyglot) run_polyglot ;;
  *)
    echo "sandbox-runtime: unknown language: $LANG_NAME" >&2
    exit 65
    ;;
esac
