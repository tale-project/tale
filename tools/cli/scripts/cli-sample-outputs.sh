#!/usr/bin/env bash
#
# cli-sample-outputs.sh — capture sanitised `tale` command output for docs.
#
# Runs a curated set of `tale` commands and pipes each through a sanitiser that
# strips anything identifying before the text reaches a screenshot or a code
# block. A raw terminal capture leaks the real username, hostname, home path,
# and any email in the output; published docs must never show a real person.
# The sanitiser replaces those with neutral stand-ins:
#
#   - the current $USER                  -> user
#   - any email address                  -> user@example.com
#   - the machine hostname               -> tale
#   - the user's home directory          -> /home/user
#
# Usage:
#   tools/cli/scripts/cli-sample-outputs.sh [command ...]
#
# With no arguments it runs the default command set below. Pass one or more
# quoted `tale ...` invocations to capture a specific command instead, e.g.
#
#   tools/cli/scripts/cli-sample-outputs.sh "tale status" "tale --help"
#
# Output goes to stdout. Redirect it, or screenshot the terminal AFTER this
# script has sanitised the text — see .agents/docs/SCREENSHOTS.md.

set -euo pipefail

# --- sanitiser ---------------------------------------------------------------

# Values we scrub. Computed once so the sed program is stable across lines.
REAL_USER="${USER:-$(id -un 2>/dev/null || echo user)}"
REAL_HOST="$(hostname 2>/dev/null || echo localhost)"
# Short hostname too (strip any domain) so `host.example.com` and `host` both go.
REAL_HOST_SHORT="${REAL_HOST%%.*}"
REAL_HOME="${HOME:-/root}"

# Escape a string for safe use inside a sed regex / replacement.
sed_escape() {
  printf '%s' "$1" | sed -e 's/[.[\*^$()+?{|]/\\&/g' -e 's/\//\\\//g'
}

USER_RE="$(sed_escape "$REAL_USER")"
HOST_RE="$(sed_escape "$REAL_HOST")"
HOST_SHORT_RE="$(sed_escape "$REAL_HOST_SHORT")"
HOME_RE="$(sed_escape "$REAL_HOME")"

# Read stdin, emit sanitised text. Order matters: replace the home path before
# the username so `/home/<user>` collapses cleanly, and emails before the bare
# username so an address is fully neutralised rather than half-rewritten.
#
# Word boundaries are written as `([^A-Za-z0-9_]|^)` / `([^A-Za-z0-9_]|$)`
# rather than `\b`, because `\b` is a GNU-sed extension that BSD sed (macOS)
# does not honour — the explicit character classes work identically on both.
# The boundary captures are preserved with `\1` / `\2` so we only rewrite the
# token, not the surrounding punctuation.
sanitise() {
  local B='([^A-Za-z0-9_]|^)'
  local A='([^A-Za-z0-9_]|$)'
  sed -E \
    -e "s/${HOME_RE}/\/home\/user/g" \
    -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/user@example.com/g' \
    -e "s/${B}${HOST_RE}${A}/\1tale\2/g" \
    -e "s/${B}${HOST_SHORT_RE}${A}/\1tale\2/g" \
    -e "s/${B}${USER_RE}${A}/\1user\2/g"
}

# --- command runner ----------------------------------------------------------

# Resolve the `tale` binary: prefer one on PATH, else fall back to running the
# CLI from this repo with bun so the script works in a fresh checkout.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

run_tale() {
  if command -v tale >/dev/null 2>&1; then
    tale "$@"
  else
    (cd "$CLI_ROOT" && bun run src/index.ts "$@")
  fi
}

# Print a labelled, sanitised capture for one command line. Failures are
# tolerated (some commands need a running stack) — the stderr note is captured
# too so the docs author sees what happened.
capture() {
  local cmdline="$1"
  printf '$ %s\n' "$cmdline"
  # shellcheck disable=SC2086 # intentional word-splitting of the command line.
  run_tale ${cmdline#tale } 2>&1 | sanitise || true
  printf '\n'
}

# --- main --------------------------------------------------------------------

# Default set: read-only commands that produce representative output without
# needing a running deployment. Override by passing commands as arguments.
DEFAULT_COMMANDS=(
  "tale --version"
  "tale --help"
  "tale init --help"
  "tale start --help"
  "tale deploy --help"
)

main() {
  local commands=()
  if [[ $# -gt 0 ]]; then
    commands=("$@")
  else
    commands=("${DEFAULT_COMMANDS[@]}")
  fi

  for cmd in "${commands[@]}"; do
    capture "$cmd"
  done
}

main "$@"
