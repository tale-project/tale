#!/usr/bin/env bun
import { sleep } from './lib/docker';
// =============================================================================
// Tale — Sandbox Runtime Image Conformance Test
// =============================================================================
// Builds the sandbox-runtime image and asserts BOTH roles it serves from one
// image (sessions plan, single-image decision):
//   1. One-shot /v1/execute role — runs as uid 65534, python/node present.
//   2. Agent session role — runs as the `agent` user (uid 10001) with the
//      coding-agent tooling (claude, opencode, gh, playwright MCP, git/rg/fd),
//      a writable HOME, and runnerd bootable under the `daemon` entrypoint.
//
// No LLM key + no cluster needed — image conformance only.
//
// Usage:
//   bun tests/container-sandbox-runtime-test.ts
// Env:
//   SKIP_BUILD=true     reuse an existing tale-sandbox-runtime:contest image
//   IMAGE=<ref>         test a prebuilt image instead of building
// =============================================================================
import { capture, ok, projectRoot, stdoutOf, stream } from './lib/exec';
import { BOLD, GREEN, NC, RED } from './lib/log';

const PROJECT_ROOT = projectRoot();
const IMAGE = process.env.IMAGE || 'tale-sandbox-runtime:contest';

let passed = 0;
let failed = 0;
const pass = (msg: string): void => {
  console.log(`  ${GREEN}✓${NC} ${msg}`);
  passed++;
};
const fail = (msg: string): void => {
  console.log(`  ${RED}✗${NC} ${msg}`);
  failed++;
};

/** Run a command in the image as a given uid via `sh -c`; capture combined output. */
function runAs(uid: number, cmd: string) {
  return capture([
    'docker',
    'run',
    '--rm',
    '--user',
    String(uid),
    '--tmpfs',
    `/workspace:uid=${uid},gid=${uid}`,
    // A writable HOME, like every real sandbox run (the entrypoint exports one
    // on the workspace) — opencode writes cache/log state even on --version.
    '--env',
    'HOME=/workspace',
    '--entrypoint',
    'sh',
    IMAGE,
    '-c',
    cmd,
  ]);
}

/** Assert a command in the image (as uid) exits 0. */
async function assertOk(desc: string, uid: number, cmd: string): Promise<void> {
  const { exitCode } = await runAs(uid, cmd);
  if (exitCode === 0) pass(desc);
  else fail(desc);
}

/** Assert a command's combined output contains a substring. */
async function assertContains(
  desc: string,
  uid: number,
  needle: string,
  cmd: string,
): Promise<void> {
  const { combined } = await runAs(uid, cmd);
  if (combined.includes(needle)) pass(desc);
  else fail(`${desc} (got: ${combined.slice(0, 200)})`);
}

console.log(`${BOLD}Sandbox runtime image conformance${NC}`);

if (process.env.SKIP_BUILD !== 'true' && !process.env.IMAGE_PREBUILT) {
  console.log(`Building ${IMAGE} ...`);
  const code = await stream(
    [
      'docker',
      'build',
      '-t',
      IMAGE,
      '-f',
      'services/sandbox-runtime/Dockerfile',
      PROJECT_ROOT,
    ],
    { cwd: PROJECT_ROOT },
  );
  if (code !== 0) {
    console.error(`${RED}Build failed!${NC}`);
    process.exit(1);
  }
}

console.log('');
console.log('--- one-shot role (uid 65534) ---');
await assertContains('python3 present', 65534, 'Python 3', 'python3 --version');
await assertContains('node present', 65534, 'v', 'node --version');
await assertOk('uv present', 65534, 'command -v uv');
// bun + bunx — many JS/TS projects (Tale included) use them.
await assertOk('bun present', 65534, 'command -v bun && command -v bunx');

console.log('');
console.log('--- agent session role (uid 10001) ---');
// agent user is a real passwd entry (fixes git/"I have no name!").
await assertContains(
  'agent uid resolves to a name',
  10001,
  'agent',
  'id -un || whoami',
);
await assertOk('claude on PATH', 10001, 'command -v claude');
await assertOk('opencode on PATH', 10001, 'command -v opencode');
await assertOk('hermes on PATH', 10001, 'command -v hermes');
await assertOk('codex on PATH', 10001, 'command -v codex');
await assertOk(
  'tale-hermes-run wrapper present',
  10001,
  'test -x /usr/local/bin/tale-hermes-run',
);
await assertOk('gh on PATH', 10001, 'command -v gh');
await assertOk(
  'git/ripgrep/fd present',
  10001,
  'command -v git && command -v rg && command -v fd',
);
await assertOk(
  'playwright MCP server present',
  10001,
  'command -v mcp-server-playwright || ls /opt/agents/bin/*playwright* 2>/dev/null',
);
// Launcher shim the adapters invoke (bridges HTTPS_PROXY/NO_PROXY to flags).
await assertOk(
  'playwright MCP launcher shim present',
  10001,
  'test -x /usr/local/bin/tale-playwright-mcp',
);
// The baked browser must match the revision the MCP's BUNDLED playwright resolves.
await assertOk(
  "chromium matches the MCP's bundled playwright revision",
  10001,
  'node -e \'const p=require("/opt/agents/lib/node_modules/@playwright/mcp/node_modules/playwright-core"); require("fs").accessSync(p.chromium.executablePath())\'',
);
// Pinned versions resolve (a broken install would non-zero here).
await assertOk('claude --version runs', 10001, 'claude --version');
await assertOk('opencode --version runs', 10001, 'opencode --version');
await assertOk('hermes --version runs', 10001, 'hermes --version');
await assertOk('codex --version runs', 10001, 'codex --version');
// The wrapper's hermes-agent integration: ast-parse tale-hermes-run (also
// proves it is valid Python), collect every kwarg it passes to AIAgent(...)
// and agent.run_conversation(...), and assert the PINNED hermes-agent's real
// signatures accept them — a version bump that renames/removes a kwarg fails
// here instead of at the first real run. No model call, no key needed.
{
  const sigCheck = `
import ast, inspect

from run_agent import AIAgent

src = open("/usr/local/bin/tale-hermes-run").read()
tree = ast.parse(src)  # SyntaxError here = broken wrapper

def kwargs_of(pred):
    return {
        kw.arg
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and pred(node.func)
        for kw in node.keywords
        if kw.arg is not None
    }

def accepts(sig, passed):
    var_kw = any(
        p.kind is inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()
    )
    return sorted(k for k in passed if k not in sig.parameters and not var_kw)

ctor = kwargs_of(lambda f: isinstance(f, ast.Name) and f.id == "AIAgent")
assert ctor, "no AIAgent(...) call found in tale-hermes-run"
missing = accepts(inspect.signature(AIAgent.__init__), ctor)
assert not missing, f"AIAgent.__init__ rejects wrapper kwargs: {missing}"

run = kwargs_of(
    lambda f: isinstance(f, ast.Attribute) and f.attr == "run_conversation"
)
assert run, "no run_conversation(...) call found in tale-hermes-run"
missing = accepts(inspect.signature(AIAgent.run_conversation), run)
assert not missing, f"run_conversation rejects wrapper kwargs: {missing}"

print("HERMES_WRAPPER_SIGNATURE_OK")
`;
  await assertContains(
    'tale-hermes-run kwargs match the pinned hermes-agent signatures',
    10001,
    'HERMES_WRAPPER_SIGNATURE_OK',
    `python3 - <<'PYEOF'\n${sigCheck}\nPYEOF`,
  );
}
await assertOk('agent on PATH', 10001, 'command -v agent');
await assertOk('agent --version runs', 10001, 'agent --version');
// HOME on the workspace volume must be writable for agent state.
await assertOk(
  'HOME writable for agent state',
  10001,
  'mkdir -p /workspace/.home/.claude && touch /workspace/.home/.claude/probe',
);

// Non-root → Claude Code's bypassPermissions is allowed (it refuses as root).
console.log('');
console.log('--- bypassPermissions allowed for non-root ---');
{
  const { combined } = await runAs(
    10001,
    "claude -p --permission-mode bypassPermissions --max-turns 1 'noop' 2>&1 || true",
  );
  if (/cannot.*root|root.*not.*allowed/i.test(combined)) {
    fail('bypassPermissions rejected as root (should be allowed at uid 10001)');
  } else {
    pass('bypassPermissions not rejected at uid 10001');
  }
}

console.log('');
console.log('--- playwright MCP navigate under session constraints ---');
// Drive the REAL MCP surface — the tale-playwright-mcp shim with the exact
// argv the agent adapters pass — under the session container contract
// (read-only rootfs, exec tmpfs /tmp, agent uid, sized /dev/shm).
{
  const nodeScript = `const { spawn } = require('child_process');
const srv = spawn(
  'tale-playwright-mcp',
  ['--headless', '--browser', 'chromium', '--isolated', '--no-sandbox'],
  { stdio: ['pipe', 'pipe', 'inherit'] },
);
const send = (o) => srv.stdin.write(JSON.stringify(o) + '\\n');
const deadline = setTimeout(() => { console.error('MCP_TIMEOUT'); process.exit(1); }, 90000);
let buf = '';
srv.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\\n')) >= 0) {
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
`;
  const { combined } = await capture(
    [
      'docker',
      'run',
      '--rm',
      '-i',
      '--user',
      '10001',
      '--read-only',
      '--tmpfs',
      '/tmp:exec,nosuid,nodev,size=256m',
      '--tmpfs',
      '/workspace:uid=10001,gid=10001',
      '--shm-size=512m',
      '--env',
      'HOME=/workspace/.home',
      '--env',
      'TMPDIR=/workspace/.tmp',
      '--entrypoint',
      'sh',
      IMAGE,
      '-c',
      'mkdir -p "$HOME" "$TMPDIR" && exec node -',
    ],
    { stdin: nodeScript },
  );
  if (combined.includes('MCP_NAVIGATE_OK')) {
    pass('playwright MCP navigates at uid 10001 on read-only rootfs');
  } else {
    fail(`playwright MCP navigate failed (got: ${combined.slice(0, 300)})`);
  }
}

console.log('');
console.log('--- runnerd boots under the daemon entrypoint ---');
// Start the daemon (PID 1 via the image entrypoint `daemon` arg) and probe
// /readyz. No token (unsigned dev mode) so the probe is unauthenticated.
{
  const cid = await stdoutOf([
    'docker',
    'run',
    '-d',
    '--user',
    '10001',
    // The workspace skeleton lives under /user (sessions path model) — the
    // daemon entrypoint mkdirs there and dies without a writable mount.
    '--tmpfs',
    '/user:uid=10001,gid=10001',
    IMAGE,
    'daemon',
  ]);
  try {
    let ready = false;
    for (let i = 0; i < 20; i++) {
      if (
        await ok([
          'docker',
          'exec',
          cid,
          'sh',
          '-c',
          'command -v curl >/dev/null && curl -fsS http://127.0.0.1:8200/readyz',
        ])
      ) {
        ready = true;
        break;
      }
      await sleep(500);
    }
    if (ready) pass('runnerd /readyz answers under daemon mode');
    else fail('runnerd did not become ready');
  } finally {
    if (cid) await ok(['docker', 'rm', '-f', cid]);
  }
}

console.log('');
console.log(
  '--- session exec temp lands on the workspace, not the /tmp tmpfs ---',
);
// Regression for run_code ENOSPC: pip stages a whole target install set in
// $TMPDIR, so the daemon entrypoint must point TMPDIR at the disk-backed
// workspace — the default profile's /tmp is a 128m memory-backed tmpfs.
// Boot under the production session contract (read-only rootfs, sized /tmp)
// and assert (a) runnerd's TMPDIR is on the workspace and (b) a temp write
// bigger than the /tmp tmpfs succeeds. Both fail on a TMPDIR=/tmp entrypoint.
{
  const cid = await stdoutOf([
    'docker',
    'run',
    '-d',
    '--user',
    '10001',
    '--read-only',
    '--tmpfs',
    '/tmp:exec,nosuid,nodev,size=128m',
    '--tmpfs',
    '/user:uid=10001,gid=10001',
    IMAGE,
    'daemon',
  ]);
  try {
    let ready = false;
    for (let i = 0; i < 20; i++) {
      if (
        await ok([
          'docker',
          'exec',
          cid,
          'sh',
          '-c',
          'curl -fsS http://127.0.0.1:8200/readyz',
        ])
      ) {
        ready = true;
        break;
      }
      await sleep(500);
    }
    if (!ready) {
      fail('runnerd did not become ready under the session contract');
    } else {
      // Execs inherit runnerd's (PID 1) env — read TMPDIR from there.
      const { exitCode, combined } = await capture([
        'docker',
        'exec',
        cid,
        'sh',
        '-c',
        `T=$(tr '\\0' '\\n' </proc/1/environ | sed -n 's/^TMPDIR=//p') && \
         test "$T" = /user/.runtime/tmp && \
         dd if=/dev/zero of="$T/enospc-probe" bs=1M count=200 2>/dev/null && \
         rm -f "$T/enospc-probe"`,
      ]);
      if (exitCode === 0) {
        pass('TMPDIR is /user/.runtime/tmp and holds a 200 MB temp write');
      } else {
        fail(
          `session TMPDIR not on the workspace or too small (got: ${combined.slice(0, 200)})`,
        );
      }
    }
  } finally {
    if (cid) await ok(['docker', 'rm', '-f', cid]);
  }
}

console.log('');
console.log(`${BOLD}Passed: ${passed}  Failed: ${failed}${NC}`);
process.exit(failed === 0 ? 0 : 1);
