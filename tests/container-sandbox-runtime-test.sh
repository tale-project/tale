#!/usr/bin/env bash
# =============================================================================
# Tale — Sandbox Runtime Image Conformance Test
# =============================================================================
# Builds the sandbox-runtime image and asserts BOTH roles it now serves from
# one image (sessions plan, single-image decision):
#   1. One-shot /v1/execute role — runs as uid 65534, python/node present.
#   2. Agent session role — runs as the `agent` user (uid 10001) with the
#      coding-agent tooling (claude, opencode, gh, playwright MCP, git/rg/fd),
#      a writable HOME, and runnerd bootable under the `daemon` entrypoint.
#
# No LLM key + no cluster needed — this is image conformance only. The live
# agent smoke (real claude -p / opencode run through Bifrost) is a separate,
# secret-gated CI lane; the kind e2e covers the K8s session lifecycle.
#
# Usage:
#   bash tests/container-sandbox-runtime-test.sh
# Env:
#   SKIP_BUILD=true     reuse an existing tale-sandbox-runtime:contest image
#   IMAGE=<ref>         test a prebuilt image instead of building
# =============================================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${IMAGE:-tale-sandbox-runtime:contest}"

RED='\033[0;31m'; GREEN='\033[0;32m'; BOLD='\033[1m'; NC='\033[0m'
PASSED=0; FAILED=0

pass() { echo -e "  ${GREEN}✓${NC} $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "  ${RED}✗${NC} $1"; FAILED=$((FAILED + 1)); }

# Run a command in the image as a given uid; print stdout, return exit code.
run_as() {
  local uid="$1"; shift
  docker run --rm --user "$uid" --entrypoint sh "$IMAGE" -c "$*"
}

# Assert a command in the image (as uid) exits 0.
assert_ok() {
  local desc="$1" uid="$2"; shift 2
  if run_as "$uid" "$*" >/dev/null 2>&1; then pass "$desc"; else fail "$desc"; fi
}

# Assert a command's stdout contains a substring.
assert_contains() {
  local desc="$1" uid="$2" needle="$3"; shift 3
  local out
  out="$(run_as "$uid" "$*" 2>&1 || true)"
  if printf '%s' "$out" | grep -q "$needle"; then
    pass "$desc"
  else
    fail "$desc (got: $(printf '%s' "$out" | head -c 200))"
  fi
}

echo -e "${BOLD}Sandbox runtime image conformance${NC}"

if [ "${SKIP_BUILD:-}" != "true" ] && [ -z "${IMAGE_PREBUILT:-}" ]; then
  echo "Building $IMAGE ..."
  docker build -t "$IMAGE" -f services/sandbox-runtime/Dockerfile "$PROJECT_ROOT"
fi

echo ""
echo "--- one-shot role (uid 65534) ---"
assert_contains "python3 present" 65534 "Python 3" "python3 --version"
assert_contains "node present" 65534 "v" "node --version"
assert_ok "uv present" 65534 "command -v uv"

echo ""
echo "--- agent session role (uid 10001) ---"
# agent user is a real passwd entry (fixes git/"I have no name!").
assert_contains "agent uid resolves to a name" 10001 "agent" "id -un || whoami"
assert_ok "claude on PATH" 10001 "command -v claude"
assert_ok "opencode on PATH" 10001 "command -v opencode"
assert_ok "gh on PATH" 10001 "command -v gh"
assert_ok "git/ripgrep/fd present" 10001 "command -v git && command -v rg && command -v fd"
assert_ok "playwright MCP server present" 10001 "command -v mcp-server-playwright || ls /opt/agents/bin/*playwright* 2>/dev/null"
# Pinned versions resolve (a broken install would non-zero here).
assert_ok "claude --version runs" 10001 "claude --version"
assert_ok "opencode --version runs" 10001 "opencode --version"
# HOME on the workspace volume must be writable for agent state.
assert_ok "HOME writable for agent state" 10001 "mkdir -p /workspace/.home/.claude && touch /workspace/.home/.claude/probe"
# Non-root → Claude Code's bypassPermissions is allowed (it refuses as root).
# We only assert the flag isn't rejected for being root; a missing key still
# errors, so accept any exit that is NOT the root-refusal message.
echo ""
echo "--- bypassPermissions allowed for non-root ---"
out="$(run_as 10001 "claude -p --permission-mode bypassPermissions --max-turns 1 'noop' 2>&1 || true" || true)"
if printf '%s' "$out" | grep -qi "cannot.*root\|root.*not.*allowed"; then
  fail "bypassPermissions rejected as root (should be allowed at uid 10001)"
else
  pass "bypassPermissions not rejected at uid 10001"
fi

echo ""
echo "--- runnerd boots under the daemon entrypoint ---"
# Start the daemon (PID 1 via the image entrypoint `daemon` arg) and probe
# /readyz. No token (unsigned dev mode) so the probe is unauthenticated.
cid="$(docker run -d --user 10001 "$IMAGE" daemon)"
trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT
ready=false
for _ in $(seq 1 20); do
  if docker exec "$cid" sh -c 'command -v curl >/dev/null && curl -fsS http://127.0.0.1:8200/readyz' >/dev/null 2>&1; then
    ready=true; break
  fi
  sleep 0.5
done
if [ "$ready" = true ]; then pass "runnerd /readyz answers under daemon mode"; else fail "runnerd did not become ready"; fi

echo ""
echo -e "${BOLD}Passed: $PASSED  Failed: $FAILED${NC}"
[ "$FAILED" -eq 0 ]
