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
  # tmpfs at /workspace mirrors the spawner contract: sessions always get a
  # writable /workspace (bind mount chowned to the runtime uid) — the baked
  # image dir is owned by 65534 and HOME=/workspace/.home is unwritable
  # without it.
  docker run --rm --user "$uid" --tmpfs "/workspace:uid=${uid},gid=${uid}" \
    --entrypoint sh "$IMAGE" -c "$*"
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
# bun + bunx — many JS/TS projects (Tale included) use them; an in-sandbox
# agent needs them on PATH for install/test/scripts.
assert_ok "bun present" 65534 "command -v bun && command -v bunx"

echo ""
echo "--- agent session role (uid 10001) ---"
# agent user is a real passwd entry (fixes git/"I have no name!").
assert_contains "agent uid resolves to a name" 10001 "agent" "id -un || whoami"
assert_ok "claude on PATH" 10001 "command -v claude"
assert_ok "opencode on PATH" 10001 "command -v opencode"
assert_ok "gh on PATH" 10001 "command -v gh"
assert_ok "git/ripgrep/fd present" 10001 "command -v git && command -v rg && command -v fd"
assert_ok "playwright MCP server present" 10001 "command -v mcp-server-playwright || ls /opt/agents/bin/*playwright* 2>/dev/null"
# Launcher shim the adapters invoke (bridges HTTPS_PROXY/NO_PROXY to flags).
assert_ok "playwright MCP launcher shim present" 10001 "test -x /usr/local/bin/tale-playwright-mcp"
# The browser baked into the image must match the revision the MCP's BUNDLED
# playwright resolves at runtime — an install done by any other playwright
# version drifts revisions and breaks launch (the exact bug this guards).
assert_ok "chromium matches the MCP's bundled playwright revision" 10001 \
  "node -e 'const p=require(\"/opt/agents/lib/node_modules/@playwright/mcp/node_modules/playwright-core\"); require(\"fs\").accessSync(p.chromium.executablePath())'"
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
echo "--- playwright MCP navigate under session constraints ---"
# Drive the REAL MCP surface — the tale-playwright-mcp shim with the exact
# argv the agent adapters pass (keep in sync with packages/agent_adapters) —
# under the session container contract (read-only rootfs, exec tmpfs /tmp,
# agent uid, sized /dev/shm; see docker-session-args.ts). A raw playwright
# launch can't catch this class: playwright defaults to --no-sandbox while
# the MCP defaults Chromium's sandbox ON (fatal under cap-drop=ALL), and only
# the MCP path exercises the shim, --isolated profile placement, and the
# headless-shell revision the MCP actually resolves.
smoke_out="$(docker run --rm -i --user 10001 --read-only \
  --tmpfs /tmp:exec,nosuid,nodev,size=256m \
  --tmpfs "/workspace:uid=10001,gid=10001" \
  --shm-size=512m \
  --env HOME=/workspace/.home --env TMPDIR=/workspace/.tmp \
  --entrypoint sh "$IMAGE" -c 'mkdir -p "$HOME" "$TMPDIR" && exec node -' <<'NODE_EOF' 2>&1 || true
const { spawn } = require('child_process');
const srv = spawn(
  'tale-playwright-mcp',
  ['--headless', '--browser', 'chromium', '--isolated', '--no-sandbox'],
  { stdio: ['pipe', 'pipe', 'inherit'] },
);
const send = (o) => srv.stdin.write(JSON.stringify(o) + '\n');
const deadline = setTimeout(() => { console.error('MCP_TIMEOUT'); process.exit(1); }, 90000);
let buf = '';
srv.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id === 1) {
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'browser_navigate', arguments: { url: 'about:blank' } } });
    }
    if (msg.id === 2) {
      clearTimeout(deadline);
      if (msg.error || (msg.result && msg.result.isError)) { console.error('MCP_NAVIGATE_FAILED ' + line); process.exit(1); }
      console.log('MCP_NAVIGATE_OK');
      srv.kill();
      process.exit(0);
    }
  }
});
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'conformance', version: '1.0' } } });
NODE_EOF
)"
if printf '%s' "$smoke_out" | grep -q "MCP_NAVIGATE_OK"; then
  pass "playwright MCP navigates at uid 10001 on read-only rootfs"
else
  fail "playwright MCP navigate failed (got: $(printf '%s' "$smoke_out" | head -c 300))"
fi

echo ""
echo "--- runnerd boots under the daemon entrypoint ---"
# Start the daemon (PID 1 via the image entrypoint `daemon` arg) and probe
# /readyz. No token (unsigned dev mode) so the probe is unauthenticated.
cid="$(docker run -d --user 10001 --tmpfs /workspace:uid=10001,gid=10001 "$IMAGE" daemon)"
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
