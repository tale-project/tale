#!/usr/bin/env bun
// =============================================================================
// Tale — Sandbox Runtime Image Conformance Test
// =============================================================================
// Builds the sandbox-runtime image and checks both session profiles:
//   1. Default code/render profile — uid 65534, Python/Node and headless browser.
//   2. Agent profile — runs as the `agent` user (uid 10001) with the
//      external-agent tooling (claude, opencode, gh, playwright MCP, git/rg/fd),
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
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse as parseYaml } from 'yaml';

import { checkCodexRoundTrip } from './lib/codex-round-trip';
import { sleep } from './lib/docker';
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
console.log('--- default session profile (uid 65534) ---');
await assertContains('python3 present', 65534, 'Python 3', 'python3 --version');
await assertContains('node present', 65534, 'v', 'node --version');
await assertOk('uv present', 65534, 'command -v uv');
// bun + bunx — many JS/TS projects (Tale included) use them.
await assertOk('bun present', 65534, 'command -v bun && command -v bunx');
// Batch vision CLI — chat run_code execs run at this uid.
await assertOk(
  'tale-vision present',
  65534,
  'test -x /usr/local/bin/tale-vision',
);
await assertOk(
  'tale-vision venv imports Pillow under -E',
  65534,
  '/opt/tale-vision/bin/python -E -c "import PIL"',
);
// The shim must neutralize the per-exec user PYTHONPATH (entrypoint.sh
// prepends /agent/.runtime/deps/python) or a user-installed fake PIL could
// shadow the venv's.
await assertOk(
  'tale-vision shim runs python -E -s',
  65534,
  "grep -q ' -E -s ' /usr/local/bin/tale-vision",
);
await assertOk(
  'venv PIL immune to PYTHONPATH shadowing',
  65534,
  `mkdir -p /workspace/fake/PIL && printf 'raise RuntimeError("shadowed")\\n' > /workspace/fake/PIL/__init__.py && PYTHONPATH=/workspace/fake /opt/tale-vision/bin/python -E -c 'import PIL; assert "tale-vision" in PIL.__file__, PIL.__file__'`,
);

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
await assertOk('gemini on PATH', 10001, 'command -v gemini');
await assertOk(
  'tale-gemini-run wrapper present',
  10001,
  'test -x /usr/local/bin/tale-gemini-run',
);
await assertOk('pi on PATH', 10001, 'command -v pi');
await assertOk(
  'tale-pi-run wrapper present',
  10001,
  'test -x /usr/local/bin/tale-pi-run',
);
await assertOk('openclaw on PATH', 10001, 'command -v openclaw');
await assertOk(
  'tale-openclaw-run wrapper present',
  10001,
  'test -x /usr/local/bin/tale-openclaw-run',
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
// Chromium must render and capture pages without a display server in either
// profile. The source image retains browser libraries/fonts while retiring the
// managed headed browser, its viewing tunnel, and the human-control bridge.
await assertOk(
  'retired viewing binaries are absent',
  10001,
  '! command -v Xvfb && ! command -v x11vnc && ! command -v tale-human-control-mcp',
);
for (const uid of [65534, 10001]) {
  await assertContains(
    `headless Chromium renders and screenshots as uid ${uid}`,
    uid,
    'HEADLESS_BROWSER_OK',
    `node <<'NODEEOF'
const assert = require('node:assert/strict');
const { chromium } = require('/opt/agents/lib/node_modules/@playwright/mcp/node_modules/playwright-core');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent('<h1>Sandbox headless rendering</h1>');
    assert.equal(await page.locator('h1').textContent(), 'Sandbox headless rendering');
    const png = await page.screenshot({ path: '/workspace/headless.png' });
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    console.log('HEADLESS_BROWSER_OK');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
NODEEOF`,
  );
}
// Every bundled harness must start offline from an empty HOME as the agent,
// report its exact source pin, and finish within a generous cold-start bound.
// Print timings so upgrades expose startup regressions without a noisy
// machine-speed microbenchmark. Separate homes prevent one CLI warming another.
{
  const dockerfile = readFileSync(
    join(PROJECT_ROOT, 'services/sandbox-runtime/Dockerfile'),
    'utf8',
  );
  const harnessPins = [
    ['claude-code', 'claude', 'CLAUDE_CODE_VERSION'],
    ['codex', 'codex', 'CODEX_VERSION'],
    ['cursor', 'agent', 'CURSOR_AGENT_VERSION'],
    ['gemini', 'gemini', 'GEMINI_CLI_VERSION'],
    ['hermes', 'hermes', 'HERMES_AGENT_VERSION'],
    ['openclaw', 'openclaw', 'OPENCLAW_VERSION'],
    ['opencode', 'opencode', 'OPENCODE_VERSION'],
    ['pi', 'pi', 'PI_CODING_AGENT_VERSION'],
    ['qwen-code', 'qwen', 'QWEN_CODE_VERSION'],
  ] as const;
  const registrySlugs = readdirSync(
    join(PROJECT_ROOT, 'configs/platform/system/harnesses'),
    { withFileTypes: true },
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (
    JSON.stringify(registrySlugs) !==
    JSON.stringify(harnessPins.map(([slug]) => slug))
  ) {
    fail('every registry harness has an exact-version startup probe');
  }
  const probes: { slug: string; binary: string; version: string }[] =
    harnessPins.map(([slug, binary, pin]) => {
      const version = dockerfile.match(
        new RegExp(`^ARG ${pin}=([^\\s]+)$`, 'm'),
      )?.[1];
      if (!version) throw new Error(`Missing exact image pin ${pin}`);
      return { slug, binary, version };
    });
  const nodeVersion = dockerfile.match(
    /COPY --from=node:([\d.]+)-bookworm-slim/,
  )?.[1];
  if (!nodeVersion) throw new Error('Missing exact Node image pin');
  probes.unshift({ slug: 'node', binary: 'node', version: nodeVersion });
  const probeScript = String.raw`
import json, os, re, signal, subprocess, sys, time

failures = 0
for probe in json.loads(sys.argv[1]):
    home = '/workspace/' + probe['slug']
    os.mkdir(home)
    env = dict(os.environ, HOME=home, XDG_CACHE_HOME=home + '/.cache',
               XDG_CONFIG_HOME=home + '/.config', XDG_DATA_HOME=home + '/.local/share')
    started = time.monotonic()
    proc = subprocess.Popen([probe['binary'], '--version'], cwd=home, env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, start_new_session=True)
    try:
        output, _ = proc.communicate(timeout=60)
        pattern = r'(?<![\w.-])v?' + re.escape(probe['version']) + r'(?![\w.-])'
        assert proc.returncode == 0, f'exit {proc.returncode}: {output[-2000:]}'
        assert re.search(pattern, output), f'expected {probe["version"]}: {output[-2000:]}'
        elapsed = round((time.monotonic() - started) * 1000)
        print(f'{probe["slug"]} {probe["version"]}: {elapsed} ms', flush=True)
    except (subprocess.TimeoutExpired, AssertionError) as error:
        failures += 1
        print(f'{probe["slug"]}: {error}', file=sys.stderr, flush=True)
    finally:
        # Also reap CLI background children after an otherwise successful probe.
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.communicate(timeout=5)
sys.exit(1 if failures else 0)
`;
  const result = await capture([
    'docker',
    'run',
    '--rm',
    '--network=none',
    '--read-only',
    '--cap-drop=ALL',
    '--user=10001:10001',
    '--tmpfs=/workspace:uid=10001,gid=10001',
    '--tmpfs=/tmp:mode=1777',
    '--entrypoint=python3',
    IMAGE,
    '-c',
    probeScript,
    JSON.stringify(probes),
  ]);
  console.log(result.combined.trim());
  if (result.exitCode === 0)
    pass('all exact harness pins start offline within 60 seconds each');
  else fail('exact harness versions or bounded offline startup');
}
// The npm launcher is a Node process that would stay the binary's parent for
// the whole run; `codex` on PATH execs the native binary directly.
await assertOk(
  'codex runs its native binary without a Node parent',
  10001,
  'head -n1 "$(command -v codex)" | grep -qx "#!/bin/sh"',
);
await assertOk(
  'tale-qwen-run wrapper present',
  10001,
  'test -x /usr/local/bin/tale-qwen-run',
);
// Exercise startup, native tool execution and completion against a bounded
// loopback Responses server. Codex now waits for network recovery on a refused
// connection, so an unreachable port cannot serve as a terminating probe.
try {
  await checkCodexRoundTrip(IMAGE);
  pass('codex completes a native tool round trip with parsed text and usage');
} catch (error) {
  fail(`codex native tool round trip: ${String(error)}`);
}
// The entrypoint creates every harness state root a harness.yml points at
// under HOME, or the harness refuses to start (Codex above). Registry and
// entrypoint are pinned to each other here, in the lane that cannot run
// the entrypoint itself.
{
  const harnessesDir = join(PROJECT_ROOT, 'configs/platform/system/harnesses');
  const entrypoint = readFileSync(
    join(PROJECT_ROOT, 'services/sandbox-runtime/entrypoint.sh'),
    'utf8',
  );
  const roots = readdirSync(harnessesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const facts = parseYaml(
        readFileSync(join(harnessesDir, entry.name, 'harness.yml'), 'utf8'),
      ) as { env?: { base?: Record<string, string> } };
      return Object.values(facts.env?.base ?? {})
        .filter((value) => value.startsWith('/agent/.runtime/home/'))
        .map((value) => ({ slug: entry.name, root: value }));
    });
  for (const { slug, root } of roots) {
    if (
      entrypoint.includes(`    ${root} \\`) ||
      entrypoint.includes(`    ${root}\n`)
    ) {
      pass(`entrypoint creates ${slug}'s state root ${root}`);
    } else {
      fail(
        `entrypoint does not create ${slug}'s state root ${root} (harness.yml env.base)`,
      );
    }
  }
}
// The registry is the contract: every harness the platform advertises as
// runnable on a managed credential must have its exec binary on the agent
// PATH — a harness.yml added (or a wrapper renamed) without the image
// following fails here, not on a user's first task.
{
  const harnessesDir = join(PROJECT_ROOT, 'configs/platform/system/harnesses');
  const slugs = readdirSync(harnessesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  for (const slug of slugs) {
    const facts = parseYaml(
      readFileSync(join(harnessesDir, slug, 'harness.yml'), 'utf8'),
    ) as {
      credentialPolicy?: { managed?: boolean };
      exec?: { bin?: string };
    };
    const bin = facts.exec?.bin;
    if (facts.credentialPolicy?.managed !== true || bin === undefined) {
      continue;
    }
    await assertOk(
      `registry: managed harness "${slug}" exec "${bin}" is on the agent PATH`,
      10001,
      `command -v ${bin}`,
    );
  }
}
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
// The wrapper's gemini-cli integration: ast-parse tale-gemini-run (also
// proves it is valid Python), collect every long flag it passes on the
// `gemini` command line, and assert the PINNED CLI's real --help lists each
// one — a version bump that renames/removes a flag fails here instead of at
// the first real run. No model call, no key needed.
{
  const flagCheck = `
import ast, subprocess

src = open("/usr/local/bin/tale-gemini-run").read()
tree = ast.parse(src)  # SyntaxError here = broken wrapper

flags = {
    el.value
    for node in ast.walk(tree)
    if isinstance(node, ast.List)
    for el in node.elts
    if isinstance(el, ast.Constant)
    and isinstance(el.value, str)
    and el.value.startswith("--")
}
flags |= {
    el.value
    for node in ast.walk(tree)
    if isinstance(node, ast.AugAssign)
    for el in ast.walk(node.value)
    if isinstance(el, ast.Constant)
    and isinstance(el.value, str)
    and el.value.startswith("--")
}
assert "--output-format" in flags, f"wrapper gemini flags not found: {flags}"

help_text = subprocess.run(
    ["gemini", "--help"], capture_output=True, text=True, check=True
).stdout
missing = sorted(f for f in flags if f not in help_text)
assert not missing, f"pinned gemini-cli --help lacks wrapper flags: {missing}"

print("GEMINI_WRAPPER_FLAGS_OK")
`;
  await assertContains(
    'tale-gemini-run flags match the pinned gemini-cli --help',
    10001,
    'GEMINI_WRAPPER_FLAGS_OK',
    `python3 - <<'PYEOF'\n${flagCheck}\nPYEOF`,
  );
}
// The pinned gemini-cli requests the model id it was given. Every release
// before 0.61.0 rewrites any --model ending in "flash" to its own gemini-3.5-flash on API-key auth
// (config/models.ts resolveModel → isFlashModel = endsWith('flash')), which
// sent a managed `…/deepseek-flash` to the gateway as a bare gemini-3.5-flash
// (2026-09-30). The harness YAML turns on dynamic model configuration, whose
// resolveModelId passes an unknown id through. Drive the real wrapper with
// those settings against a loopback stand-in for the gateway and read the
// request path and first request's policy — no key, no network. The stand-in
// answers 400 (not retried) so the CLI stops after its first call. A hostile
// workspace settings file must not override the immutable system policy.
// Keep the dynamic-model setting for older platform images during rollout;
// upstream also stopped rewriting unrelated flash IDs in 0.61.0.
{
  const modelIdCheck = `
import http.server, json, os, pathlib, stat, subprocess, tempfile, threading

seen = []


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)))
        seen.append((self.path, request))
        body = json.dumps(
            {"error": {"code": 400, "message": "probe", "status": "INVALID_ARGUMENT"}}
        ).encode()
        self.send_response(400)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
env = dict(
    os.environ,
    GOOGLE_GEMINI_BASE_URL=f"http://127.0.0.1:{server.server_address[1]}",
    GEMINI_API_KEY="probe-key",
)
MODEL = "probe-provider/probe-model-flash"


def request_path(settings, workdir):
    del seen[:]
    payload = json.dumps({"prompt": "probe", "settings": settings, "system_prompt": "TALE_GEMINI_CONTEXT_PROBE"})
    result = subprocess.run(
        ["tale-gemini-run", "--workdir", workdir, "--model", MODEL],
        input=payload.encode(),
        env=env,
        capture_output=True,
        timeout=120,
    )
    assert len(seen) == 1, f"expected one model call, saw {len(seen)}: {result.stderr.decode()} {result.stdout.decode()}"
    assert b"Security Warning: Skipping" not in result.stderr, result.stderr.decode()
    request = seen[0][1]
    assert "TALE_GEMINI_CONTEXT_PROBE" in json.dumps(request), "appended instructions missing"
    tool_names = {
        declaration.get("name")
        for tool in request.get("tools", [])
        for declaration in tool.get("functionDeclarations", [])
    }
    assert not ({"google_web_search", "web_fetch"} & tool_names), tool_names
    assert not any("googleSearch" in tool for tool in request.get("tools", [])), request.get("tools")
    return seen[0][0].split(":", 1)[0]


base = {
    "security": {"auth": {"selectedType": "gemini-api-key"}},
    "privacy": {"usageStatisticsEnabled": False},
    "model": {"maxSessionTurns": 200},
    "tools": {"exclude": ["google_web_search", "web_fetch"]},
    "experimental": {"dynamicModelConfiguration": True},
}
policies = list(pathlib.Path("/usr/local/share/tale/gemini-settings").glob("*.json"))
assert len(policies) == 6, f"missing built Gemini policies: {policies}"
for policy in policies:
    for entry in (policy, *policy.parents):
        info = entry.stat()
        assert info.st_uid == 0 and not (stat.S_IMODE(info.st_mode) & 0o022), str(entry)
    assert not os.access(policy, os.W_OK), str(policy)
with tempfile.TemporaryDirectory(prefix="gemini-policy-probe-") as workspace:
    repo_config = pathlib.Path(workspace) / ".gemini"
    repo_config.mkdir()
    (repo_config / "settings.json").write_text(json.dumps({
        "security": {"auth": {"selectedType": "oauth-personal"}},
        "privacy": {"usageStatisticsEnabled": True},
        "model": {"maxSessionTurns": 0},
        "tools": {"exclude": []},
        "context": {"fileName": "unrelated.md"},
    }))
    kept = request_path(base, workspace)
    assert kept == f"/v1beta/models/{MODEL}", f"model id rewritten to {kept}"

print("GEMINI_MODEL_ID_KEPT")
`;
  await assertContains(
    'pinned gemini-cli keeps a flash-suffixed --model with the harness settings',
    10001,
    'GEMINI_MODEL_ID_KEPT',
    `python3 - <<'PYEOF'\n${modelIdCheck}\nPYEOF`,
  );
}
// Same wrapper/CLI drift guard for tale-pi-run: every long flag the wrapper
// passes on the `pi` command line must exist in the pinned CLI's --help.
{
  const flagCheck = `
import ast, subprocess

src = open("/usr/local/bin/tale-pi-run").read()
tree = ast.parse(src)  # SyntaxError here = broken wrapper

flags = {
    el.value
    for node in ast.walk(tree)
    if isinstance(node, ast.List)
    for el in node.elts
    if isinstance(el, ast.Constant)
    and isinstance(el.value, str)
    and el.value.startswith("--")
}
flags |= {
    el.value
    for node in ast.walk(tree)
    if isinstance(node, ast.AugAssign)
    for el in ast.walk(node.value)
    if isinstance(el, ast.Constant)
    and isinstance(el.value, str)
    and el.value.startswith("--")
}
assert "--mode" in flags, f"wrapper pi flags not found: {flags}"

help_text = subprocess.run(
    ["pi", "--help"], capture_output=True, text=True, check=True
).stdout
missing = sorted(f for f in flags if f not in help_text)
assert not missing, f"pinned pi --help lacks wrapper flags: {missing}"

print("PI_WRAPPER_FLAGS_OK")
`;
  await assertContains(
    'tale-pi-run flags match the pinned pi --help',
    10001,
    'PI_WRAPPER_FLAGS_OK',
    `python3 - <<'PYEOF'\n${flagCheck}\nPYEOF`,
  );
}
// The wrapper's openclaw integration: ast-parse tale-openclaw-run (also
// proves it is valid Python), collect every long flag it passes on the
// `openclaw agent` command line, and assert the PINNED CLI's real
// `agent --help` lists each one — a version bump that renames/removes a flag
// fails here instead of at the first real run. No model call, no key needed.
{
  const flagCheck = `
import ast, subprocess

src = open("/usr/local/bin/tale-openclaw-run").read()
tree = ast.parse(src)  # SyntaxError here = broken wrapper

flags = {
    el.value
    for node in ast.walk(tree)
    if isinstance(node, ast.List)
    for el in node.elts
    if isinstance(el, ast.Constant)
    and isinstance(el.value, str)
    and el.value.startswith("--")
}
assert "--session-id" in flags, f"wrapper openclaw flags not found: {flags}"

help_text = subprocess.run(
    ["openclaw", "agent", "--help"], capture_output=True, text=True, check=True
).stdout
missing = sorted(f for f in flags if f not in help_text)
assert not missing, f"pinned openclaw agent --help lacks wrapper flags: {missing}"

print("OPENCLAW_WRAPPER_FLAGS_OK")
`;
  await assertContains(
    'tale-openclaw-run flags match the pinned openclaw agent --help',
    10001,
    'OPENCLAW_WRAPPER_FLAGS_OK',
    `python3 - <<'PYEOF'\n${flagCheck}\nPYEOF`,
  );
}
await assertOk('agent on PATH', 10001, 'command -v agent');
// External agents (session role) shell out to the same vision CLI.
await assertOk(
  'tale-vision usable at agent uid',
  10001,
  'test -x /usr/local/bin/tale-vision && /opt/tale-vision/bin/python -E -c "import PIL"',
);
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
console.log('--- playwright MCP starts only when a turn uses the browser ---');
// The launcher answers the start of a turn from the manifests the image build
// recorded for the platform's argument sets (playwright-mcp-args.json): for
// each set, the real server, a Node process holding ~100 MB, must not run
// until the first tool call, even after Qwen Code's discovery (the prompt and
// resource lists, asked whatever the server advertised), and the tool list and
// those lists must be answered as the server's own; a tool call must reach a
// server started then.
{
  const nodeScript = `const { spawn, execFileSync } = require('child_process');
const argSets = JSON.parse(require('fs').readFileSync('/opt/tale/playwright-mcp/args.json', 'utf8'));
const serverRunning = () => {
  try { execFileSync('pgrep', ['-f', 'bin/mcp-server-playwright']); return true; } catch { return false; }
};
function session(command, argv) {
  const srv = spawn(command, argv, { stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map();
  let buf = '';
  srv.stdout.on('data', (d) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf('\\n')) >= 0) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      const done = waiting.get(msg.id);
      if (done) { waiting.delete(msg.id); done(msg); }
    }
  });
  const ask = (id, method, params) => new Promise((resolve) => {
    waiting.set(id, resolve);
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\\n');
  });
  const tell = (method) => srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\\n');
  return { srv, ask, tell };
}
const init = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'conformance', version: '1.0' } };
const lists = ['prompts/list', 'resources/list', 'resources/templates/list'];
const ended = (srv) => new Promise((done) => { srv.on('exit', done); srv.kill(); });
(async () => {
  const deadline = setTimeout(() => { console.error('LAZY_TIMEOUT'); process.exit(1); }, 90000);
  let lazy;
  let listed;
  for (const [n, args] of argSets.entries()) {
    const turn = session('tale-playwright-mcp', args);
    await turn.ask(1, 'initialize', init);
    turn.tell('notifications/initialized');
    const turnListed = await turn.ask(2, 'tools/list');
    const unlisted = [];
    for (const [i, method] of lists.entries()) unlisted.push(await turn.ask(10 + i, method, {}));
    if (serverRunning()) { console.error('LAZY_SERVER_STARTED_EARLY ' + n); process.exit(1); }
    const direct = session('mcp-server-playwright', args);
    await direct.ask(1, 'initialize', init);
    direct.tell('notifications/initialized');
    const own = await direct.ask(2, 'tools/list');
    const ownUnlisted = [];
    for (const [i, method] of lists.entries()) ownUnlisted.push(await direct.ask(10 + i, method, {}));
    await ended(direct.srv);
    if (JSON.stringify(turnListed.result) !== JSON.stringify(own.result)) { console.error('LAZY_TOOLS_DIFFER ' + n); process.exit(1); }
    if (JSON.stringify(unlisted) !== JSON.stringify(ownUnlisted)) { console.error('LAZY_LISTS_DIFFER ' + n + ' ' + JSON.stringify(unlisted) + ' ' + JSON.stringify(ownUnlisted)); process.exit(1); }
    if (n === 0) { lazy = turn; listed = turnListed; } else await ended(turn.srv);
  }
  const called = await lazy.ask(3, 'tools/call', { name: 'browser_navigate', arguments: { url: 'about:blank' } });
  if (called.error || (called.result && called.result.isError)) { console.error('LAZY_NAVIGATE_FAILED ' + JSON.stringify(called)); process.exit(1); }
  clearTimeout(deadline);
  console.log('MCP_LAZY_OK ' + listed.result.tools.length);
  lazy.srv.kill();
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
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
  if (combined.includes('MCP_LAZY_OK')) {
    pass(
      'playwright MCP answers the start itself (Qwen Code discovery included) for every argument set and starts the server on the first tool call',
    );
  } else {
    fail(`playwright MCP lazy start failed (got: ${combined.slice(0, 400)})`);
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
    // The workspace skeleton lives under /agent (sessions path model) — the
    // daemon entrypoint mkdirs there and dies without a writable mount.
    '--tmpfs',
    '/agent:uid=10001,gid=10001',
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
console.log('--- runnerd runs every exec under its subreaper shim ---');
// What an exec leaves running ends with it, even a process that moved to a
// session of its own and dropped the exec's tag from its environment: the
// shim it runs under keeps every process it starts a descendant
// (daemon/exec-shim/tale-exec-shim.c), and runnerd walks down from it.
{
  const cid = await stdoutOf([
    'docker',
    'run',
    '-d',
    '--user',
    '10001',
    '--tmpfs',
    '/agent:uid=10001,gid=10001',
    IMAGE,
    'daemon',
  ]);
  const inSession = (cmd: string, stdin?: string) =>
    capture(
      [
        'docker',
        'exec',
        ...(stdin === undefined ? [] : ['-i']),
        cid,
        'sh',
        '-c',
        cmd,
      ],
      stdin === undefined ? {} : { stdin },
    );
  try {
    let ready = false;
    for (let i = 0; i < 20; i++) {
      if (
        (await inSession('curl -fsS http://127.0.0.1:8200/readyz')).exitCode ===
        0
      ) {
        ready = true;
        break;
      }
      await sleep(500);
    }
    if (!ready) {
      fail('runnerd did not become ready for the exec shim check');
    } else {
      const { combined: logs } = await capture(['docker', 'logs', cid]);
      if (logs.includes('execShim=/usr/local/bin/tale-exec-shim')) {
        pass('runnerd runs execs under /usr/local/bin/tale-exec-shim');
      } else {
        fail(`runnerd does not use the exec shim (got: ${logs.slice(0, 300)})`);
      }
      // Double-forked, in a session and group of its own, its environment
      // wiped: only the subreaper still knows it is the exec's.
      const escapee =
        '(setsid env -i /bin/sleep 421 >/dev/null 2>&1 </dev/null &); for _ in $(seq 100); do pid=$(pgrep -n -f "^/bin/sleep 421$") && break; sleep 0.02; done; echo "$pid"';
      const { stdout } = await inSession(
        "curl -sS -N --max-time 60 -H 'content-type: application/json' --data-binary @- http://127.0.0.1:8200/execs",
        JSON.stringify({
          execId: 'shim-escapee',
          shell: escapee,
          cwd: '/agent/workspace',
          env: {},
          stdinMode: 'close',
          timeoutMs: 60_000,
          stdoutMaxBytes: 1_000_000,
          stderrMaxBytes: 1_000_000,
        }),
      );
      let printed = '';
      for (const line of stdout.trim().split('\n')) {
        try {
          const event: unknown = JSON.parse(line);
          if (
            typeof event === 'object' &&
            event !== null &&
            't' in event &&
            event.t === 'stdout' &&
            'b64' in event &&
            typeof event.b64 === 'string'
          ) {
            printed += Buffer.from(event.b64, 'base64').toString('utf8');
          }
        } catch (err) {
          console.warn(
            `  runnerd answered a line that is not JSON: ${line}`,
            err,
          );
        }
      }
      const pid = Number(printed.trim());
      if (!(pid > 1)) {
        fail(`the escapee exec printed no pid (got: ${stdout.slice(0, 300)})`);
      } else {
        let gone = false;
        for (let i = 0; i < 25 && !gone; i++) {
          gone = (await inSession(`test ! -e /proc/${pid}`)).exitCode === 0;
          if (!gone) await sleep(200);
        }
        if (gone) {
          pass('a process that left its session and tag ends with its exec');
        } else {
          fail(`process ${pid} outlived the exec that started it`);
          await inSession(`kill -KILL ${pid}`);
        }
      }
    }
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
    '/agent:uid=10001,gid=10001',
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
         test "$T" = /agent/.runtime/tmp && \
         dd if=/dev/zero of="$T/enospc-probe" bs=1M count=200 2>/dev/null && \
         rm -f "$T/enospc-probe"`,
      ]);
      if (exitCode === 0) {
        pass('TMPDIR is /agent/.runtime/tmp and holds a 200 MB temp write');
      } else {
        fail(
          `session TMPDIR not on the workspace or too small (got: ${combined.slice(0, 200)})`,
        );
      }
      // The document skills' baked Node libraries resolve from the workspace
      // through runnerd's NODE_PATH, and a package the session installs into
      // its own npm prefix is found before the baked copy.
      const nodePath = await capture([
        'docker',
        'exec',
        cid,
        'sh',
        '-c',
        `N=$(tr '\\0' '\\n' </proc/1/environ | sed -n 's/^NODE_PATH=//p') && \
         test "$N" = /agent/.runtime/deps/node/lib/node_modules:/opt/tale/document-node/node_modules && \
         cd /agent/workspace && \
         NODE_PATH="$N" node -e "const p = require.resolve('docx'); if (!p.startsWith('/opt/tale/document-node/node_modules/docx/')) throw new Error(p)" && \
         S=/agent/.runtime/deps/node/lib/node_modules/docx && mkdir -p "$S" && \
         printf 'module.exports = "session";\\n' > "$S/index.js" && \
         NODE_PATH="$N" node -e "if (require('docx') !== 'session') throw new Error('baked docx shadowed the session install')"`,
      ]);
      if (nodePath.exitCode === 0) {
        pass(
          'NODE_PATH resolves the baked document libraries behind the session prefix',
        );
      } else {
        fail(
          `session NODE_PATH does not layer the baked document libraries (got: ${nodePath.combined.slice(0, 300)})`,
        );
      }
    }
  } finally {
    if (cid) await ok(['docker', 'rm', '-f', cid]);
  }
}

console.log('');
console.log('--- tale-vision analyzes against a stub gateway ---');
// End-to-end inside the image at the run_code uid: stub Anthropic-Messages
// server (429 first, then 200), 3000×1500 noise PNG → assert downscale
// (payload < original, longest edge ≤ --max-edge), NDJSON shape, retry, and
// the per-turn cache short-circuiting the second run. No real model/key.
{
  const functional = `
import base64, json, os, subprocess, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

state = {"count": 0}

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        state["count"] += 1
        if self.headers.get("authorization") != "Bearer sk-bf-test":
            self.send_response(401); self.end_headers(); return
        n = int(self.headers.get("content-length", 0))
        body = json.loads(self.rfile.read(n))
        img = body["messages"][0]["content"][0]["source"]["data"]
        with open("/workspace/sent.bin", "wb") as f:
            f.write(base64.b64decode(img))
        if state["count"] == 1:
            self.send_response(429); self.end_headers(); return
        payload = json.dumps(
            {"content": [{"type": "text", "text": f"OK#{state['count']}"}]}
        ).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass

srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
port = srv.server_address[1]

vp = "/opt/tale-vision/bin/python"
subprocess.run(
    [vp, "-E", "-c",
     "import os; from PIL import Image; "
     "Image.frombytes('RGB', (3000, 1500), os.urandom(3000*1500*3))"
     ".save('/workspace/big.png')"],
    check=True,
)
env = dict(
    os.environ,
    TALE_GATEWAY_URL=f"http://127.0.0.1:{port}",
    TALE_GATEWAY_TOKEN="sk-bf-test",
    TALE_VISION_MODEL="stub-vision",
    TMPDIR="/workspace",
)

r1 = subprocess.run(
    ["tale-vision", "/workspace/big.png", "--max-edge", "2000"],
    capture_output=True, text=True, env=env,
)
assert r1.returncode == 0, f"first run failed: {r1.stderr[:300]}"
line1 = json.loads(r1.stdout.strip().splitlines()[-1])
assert line1["ok"] and line1["cached"] is False and line1["text"] == "OK#2", line1
assert state["count"] == 2, state  # 429 → retried → 200

sent = os.path.getsize("/workspace/sent.bin")
orig = os.path.getsize("/workspace/big.png")
assert 0 < sent < orig, (sent, orig)
edge = subprocess.run(
    [vp, "-E", "-c",
     "from PIL import Image; print(max(Image.open('/workspace/sent.bin').size))"],
    capture_output=True, text=True, check=True,
).stdout.strip()
assert int(edge) <= 2000, edge

r2 = subprocess.run(
    ["tale-vision", "/workspace/big.png", "--max-edge", "2000"],
    capture_output=True, text=True, env=env,
)
line2 = json.loads(r2.stdout.strip().splitlines()[-1])
assert r2.returncode == 0 and line2["cached"] is True, (r2.returncode, line2)
assert line2["text"] == "OK#2", line2
assert state["count"] == 2, state  # cache hit → no new gateway call

print("TALE_VISION_FUNCTIONAL_OK")
`;
  await assertContains(
    'tale-vision downscale/retry/cache against a stub gateway',
    65534,
    'TALE_VISION_FUNCTIONAL_OK',
    `python3 - <<'PYEOF'\n${functional}\nPYEOF`,
  );
}

console.log('');
console.log('--- built-in skills reach every harness ---');
// runnerd links each image-baked skill (/opt/agents/skills) into every
// harness's native user-level skill dir. Only Claude Code's was linked before,
// so Codex, Gemini CLI, Qwen Code, Pi, Hermes and OpenClaw never listed the
// built-in visual-aspect-analyzer, and nothing withdrew the link when the
// workspace repository shipped a skill of the same name (#2790). Against a
// booted session: every registry harness has a dir in the table below, each dir
// holds the link, and every managed harness — its golden managed exec run
// through runnerd, as a platform turn is, against a stub model endpoint that
// records each request — names the skill in its first model request and, when
// the workspace repository ships a skill of the same name, lists the copy the
// table (and the runtime README) states.
{
  const SKILL = 'visual-aspect-analyzer';
  const HOME = '/agent/.runtime/home';
  /** Each harness's native user-level skill dir under the session HOME, and
   * the copy it lists when the workspace repository ships a same-named skill
   * in `.claude/skills` and `.agents/skills`; `null` for Cursor, which has no
   * managed lane to run. Verified against the pinned CLIs; keep in step with
   * services/sandbox-runtime/README.md "Built-in skills". */
  const SKILL_HOMES: Record<
    string,
    { dir: string; repoCopy: 'repo' | 'baked' | null }
  > = {
    'claude-code': { dir: '.claude/skills', repoCopy: 'repo' },
    codex: { dir: '.agents/skills', repoCopy: 'repo' },
    cursor: { dir: '.agents/skills', repoCopy: null },
    gemini: { dir: '.agents/skills', repoCopy: 'repo' },
    // Hermes reads no project-level skills, so it keeps the baked one.
    hermes: { dir: '.hermes/skills', repoCopy: 'baked' },
    openclaw: { dir: '.agents/skills', repoCopy: 'repo' },
    opencode: { dir: '.agents/skills', repoCopy: 'repo' },
    pi: { dir: '.agents/skills', repoCopy: 'repo' },
    'qwen-code': { dir: '.agents/skills', repoCopy: 'repo' },
  };
  const SKILL_DIRS = [...new Set(Object.values(SKILL_HOMES).map((h) => h.dir))];
  const REPO_MARKER = 'REPO-OWNED-SKILL-MARKER';
  // A plain-ASCII lead of the baked description: every harness lists it
  // verbatim (JSON escapes nothing in it), Hermes included, which truncates.
  const bakedFrontmatter = parseYaml(
    readFileSync(
      join(PROJECT_ROOT, `configs/platform/custom/skills/${SKILL}/SKILL.md`),
      'utf8',
    ).split('---')[1] ?? '',
  ) as { description?: string };
  const BAKED_LEAD = (bakedFrontmatter.description ?? '').slice(0, 40);
  // Records every request body in its own file, answers a non-retryable 400
  // so the harness ends its turn after the first model call.
  const STUB = `import json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
cap = sys.argv[2]
os.makedirs(cap, exist_ok=True)
count = [0]
class Handler(BaseHTTPRequestHandler):
    def answer(self):
        count[0] += 1
        size = int(self.headers.get("content-length") or 0)
        with open(os.path.join(cap, "%03d" % count[0]), "wb") as out:
            out.write(self.path.encode() + b"\\n" + (self.rfile.read(size) if size else b""))
        body = json.dumps({"type": "error", "error": {"type": "invalid_request_error", "message": "stub", "code": "invalid_request_error"}}).encode()
        self.send_response(400)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    do_GET = do_POST = answer
    def log_message(self, *args):
        pass
ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
`;
  interface GoldenExec {
    argv: string[];
    env?: Record<string, string>;
    cwd: string;
    stdin?: string;
  }

  const harnessesDir = join(PROJECT_ROOT, 'configs/platform/system/harnesses');
  const slugs = readdirSync(harnessesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  for (const slug of slugs) {
    if (!Object.hasOwn(SKILL_HOMES, slug)) {
      fail(
        `harness "${slug}" has no native skill dir in the built-in skills table`,
      );
    }
  }

  const cid = await stdoutOf([
    'docker',
    'run',
    '-d',
    '--user',
    '10001',
    '--tmpfs',
    '/agent:uid=10001,gid=10001',
    IMAGE,
    'daemon',
  ]);
  const inSession = (cmd: string, stdin?: string) =>
    capture(
      [
        'docker',
        'exec',
        ...(stdin === undefined ? [] : ['-i']),
        cid,
        'sh',
        '-c',
        cmd,
      ],
      stdin === undefined ? {} : { stdin },
    );
  /** One exec through runnerd's own door, the way a platform turn reaches a
   * harness: runnerd reconciles the skill links before it spawns the child.
   * Answers runnerd's last NDJSON event (the exit, or its refusal). */
  const runnerdExec = async (body: {
    execId: string;
    command: string[];
    cwd: string;
    env?: Record<string, string>;
    stdin?: string;
  }): Promise<string> => {
    const { stdout } = await inSession(
      "curl -sS -N --max-time 180 -H 'content-type: application/json' --data-binary @- http://127.0.0.1:8200/execs",
      JSON.stringify({
        execId: body.execId,
        command: body.command,
        cwd: body.cwd,
        env: body.env ?? {},
        stdinBase64: Buffer.from(body.stdin ?? '').toString('base64'),
        stdinMode: 'close',
        timeoutMs: 120_000,
        stdoutMaxBytes: 1_000_000,
        stderrMaxBytes: 1_000_000,
      }),
    );
    return stdout.trim().split('\n').at(-1) ?? '';
  };
  const linkState = async (dir: string): Promise<'linked' | 'absent'> =>
    (
      await inSession(
        `test -L ${HOME}/${dir}/${SKILL} && test -f ${HOME}/${dir}/${SKILL}/SKILL.md`,
      )
    ).exitCode === 0
      ? 'linked'
      : 'absent';
  try {
    let ready = false;
    for (let i = 0; i < 20; i++) {
      if (
        (await inSession('curl -fsS http://127.0.0.1:8200/readyz')).exitCode ===
        0
      ) {
        ready = true;
        break;
      }
      await sleep(500);
    }
    if (!ready) {
      fail('runnerd did not become ready for the built-in skills check');
    } else {
      for (const dir of SKILL_DIRS) {
        if ((await linkState(dir)) === 'linked') {
          pass(`${dir}/${SKILL} links the baked skill`);
        } else fail(`${dir}/${SKILL} does not link the baked skill`);
      }
      await inSession('cat > /agent/.runtime/tmp/skill-stub.py', STUB);
      let port = 18100;
      for (const phase of ['baked', 'repo'] as const) {
        if (phase === 'repo') {
          await inSession(
            [
              'set -e',
              'cd /agent/workspace',
              'for d in .agents/skills .claude/skills; do',
              `  mkdir -p "$d/${SKILL}"`,
              `  printf -- '---\\nname: ${SKILL}\\ndescription: ${REPO_MARKER} the repository copy\\n---\\n\\n# Repository copy\\n' > "$d/${SKILL}/SKILL.md"`,
              'done',
              'git init -q .',
            ].join('\n'),
          );
          // The next exec withdraws the links whose harnesses read the
          // repository's copy; Hermes reads none, so it keeps its link.
          await runnerdExec({
            execId: 'skills-withdraw',
            command: ['true'],
            cwd: '/agent/workspace',
          });
          for (const dir of SKILL_DIRS) {
            const want = dir === '.hermes/skills' ? 'linked' : 'absent';
            const got = await linkState(dir);
            const verdict = `${dir}/${SKILL} is ${got} beside the repository's copy`;
            if (got === want) pass(verdict);
            else fail(`${verdict} (expected ${want})`);
          }
        }
        for (const slug of slugs) {
          const home = SKILL_HOMES[slug];
          if (
            home === undefined ||
            (phase === 'repo' && home.repoCopy === null)
          ) {
            continue;
          }
          const cases = parseYaml(
            readFileSync(
              join(
                PROJECT_ROOT,
                'services/platform/lib/harnesses/fixtures/exec',
                `${slug}.yml`,
              ),
              'utf8',
            ),
          ) as Record<string, GoldenExec | undefined>;
          const exec = cases['managed-model-opus'];
          if (exec === undefined) continue;
          port += 1;
          const stubUrl = `http://127.0.0.1:${port}`;
          const sub = (value: string) =>
            value.replaceAll('http://golden-gw:8080', stubUrl);
          const recorded = `/agent/.runtime/tmp/skill-probe/${phase}-${slug}`;
          await capture([
            'docker',
            'exec',
            '-d',
            cid,
            'python3',
            '/agent/.runtime/tmp/skill-stub.py',
            String(port),
            recorded,
          ]);
          await inSession(
            `for i in $(seq 50); do curl -s -o /dev/null ${stubUrl}/ready && exit 0; sleep 0.1; done; exit 1`,
          );
          const ended = await runnerdExec({
            execId: `skills-${phase}-${slug}`,
            command: exec.argv.map(sub),
            cwd: exec.cwd,
            env: Object.fromEntries(
              Object.entries(exec.env ?? {}).map(([key, value]) => [
                key,
                sub(value),
              ]),
            ),
            stdin: sub(exec.stdin ?? ''),
          });
          const { stdout: seen } = await inSession(
            `cat ${recorded}/* 2>/dev/null`,
          );
          const runnerdSaid = ` (runnerd: ${ended.slice(0, 200)})`;
          if (phase === 'baked') {
            if (seen.includes(SKILL) && seen.includes(BAKED_LEAD)) {
              pass(`${slug} lists the baked ${SKILL} in its model request`);
            } else {
              fail(
                `${slug} does not list the baked ${SKILL} in its model request${runnerdSaid}`,
              );
            }
            continue;
          }
          const repo = seen.includes(REPO_MARKER);
          const baked = seen.includes(BAKED_LEAD);
          const listed =
            repo && baked ? 'both' : repo ? 'repo' : baked ? 'baked' : 'none';
          const copies = {
            both: 'both copies',
            repo: "the repository's copy",
            baked: 'the baked copy',
            none: 'no copy',
          };
          const verdict = `${slug} lists ${copies[listed]} when the repository ships its own ${SKILL}`;
          if (listed === home.repoCopy) pass(verdict);
          else {
            fail(
              `${verdict} (expected ${copies[home.repoCopy ?? 'none']})${runnerdSaid}`,
            );
          }
        }
      }
      // The repository drops its copy: the next exec links the baked one again.
      await inSession(
        `rm -rf /agent/workspace/.agents/skills/${SKILL} /agent/workspace/.claude/skills/${SKILL}`,
      );
      await runnerdExec({
        execId: 'skills-restore',
        command: ['true'],
        cwd: '/agent/workspace',
      });
      for (const dir of SKILL_DIRS) {
        if ((await linkState(dir)) === 'linked') {
          pass(
            `${dir}/${SKILL} links the baked skill again without the repository's`,
          );
        } else {
          fail(
            `${dir}/${SKILL} stays unlinked after the repository dropped its copy`,
          );
        }
      }
    }
  } finally {
    if (cid) await ok(['docker', 'rm', '-f', cid]);
  }
}

console.log('');
console.log(`${BOLD}Passed: ${passed}  Failed: ${failed}${NC}`);
process.exit(failed === 0 ? 0 : 1);
