#!/usr/bin/env bun
/*
  Dev orchestrator for LOCAL development:

  🔧 IMPORTANT: This script uses Convex in LOCAL mode

  When running Convex for the first time, you may see a setup prompt.
  ALWAYS choose "Local development" or "Local" option to avoid cloud dependencies.

  Process:
  1) Load environment variables from .env and .env.local files
     Priority: services/platform/.env.local > services/platform/.env > repo root/.env.local > repo root/.env
  2) Start Convex dev server in LOCAL mode (listening on 127.0.0.1:3210)
  3) Wait until it's listening on the local port (using wait-on library)
  4) Sync .env vars into Convex (SITE_URL, Entra ID keys, etc.)
  5) Trigger code generation with updated environment
  6) Start TanStack Start dev server with loaded environment variables
  7) Handle Ctrl+C (SIGINT/SIGTERM) to cleanly shut down both processes

  This ensures local development without cloud dependencies and avoids timing issues.

  Uses Bun native spawn + wait-on library for proper signal handling (Ctrl+C works correctly).
*/

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import process from 'node:process';

import kill from 'tree-kill';

const platformRoot = join(import.meta.dir, '..');
const repoRoot = join(import.meta.dir, '..', '..', '..');

// Wall-clock boot start, so the orchestrator can show how long each phase took.
// Convex pre-warm dominates a cold boot (30-90s) — surfacing it turns an opaque
// wait into a measurable number.
const BOOT_STARTED_AT = Date.now();
const sinceBoot = (): string =>
  `${((Date.now() - BOOT_STARTED_AT) / 1000).toFixed(1)}s`;

// Docker backing services the HOST `bun dev` depends on (Convex + Vite run on
// the host; these run in docker). Excludes the host-run convex/platform and the
// dev-irrelevant proxy/docs/controller. `bifrost` is the one with no published
// port in base compose.yml — see DEV_COMPOSE_FILES.
//
// Note: knowledge-db `depends_on convex` in base compose.yml only to wait for it
// to seed the shared convex-data config volume. compose.bifrost.dev.yml (host
// bun-dev only) drops that edge via `!override` — the host backend owns config
// here, not the docker convex — so this bring-up does NOT pull up a redundant
// convex container alongside the host one.
const DEV_DOCKER_SERVICES = [
  'db',
  // ParadeDB for the knowledge base / RAG search corpus (formerly the separate
  // rag + crawler services, consolidated into the tale-db image — see the
  // knowledge-db migration wiring).
  'knowledge-db',
  'bifrost',
  'sandbox',
  'sandbox-egress',
  // socat relay aliased `convex` on the sandbox net → host-run convex :3211,
  // so the in-container MCP integration bridge can reach convex http actions
  // (the `--internal` sandbox net can't otherwise reach the host).
  'convex-relay',
];
// Overlay chain for local dev (matches docs/.../docker-compose-reference): base
// + source-mounts/debug/extra_hosts (dev) + the loopback bifrost port publish
// (bifrost.dev). compose.docs.yml is required because compose.dev.yml carries a
// `docs` override whose base service lives only in compose.docs.yml — omit it
// and compose rejects the whole project ("docs has neither an image nor a build
// context"), even though we never start the docs service here. The base file
// alone leaves bifrost unreachable from the host, which kills every
// external-agent turn.
const DEV_COMPOSE_FILES = [
  'compose.yml',
  'compose.dev.yml',
  'compose.docs.yml',
  'compose.bifrost.dev.yml',
];

function parseDotEnv(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(filePath)) return result;
  const raw = readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function envNormalizeCommon() {
  process.env.NODE_ENV = 'development';
  if (!process.env.PORT) process.env.PORT = '3000';
  if (!process.env.HOSTNAME) process.env.HOSTNAME = '0.0.0.0';

  // Third-party telemetry opt-out for local dev, set in code so `.env` stays
  // clean. DO_NOT_TRACK is the cross-tool standard (consoledonottrack.com);
  // the rest are explicit per-tool toggles. `??=` lets an explicit override
  // win. (CI sets these in .github/actions/setup-turbo, Docker at runtime,
  // Storybook via its own config.)
  process.env.DO_NOT_TRACK ??= '1';
  process.env.TURBO_TELEMETRY_DISABLED ??= '1';
  process.env.STORYBOOK_DISABLE_TELEMETRY ??= '1';
  process.env.SCARF_ANALYTICS ??= 'false';
  process.env.HF_HUB_DISABLE_TELEMETRY ??= '1';

  const port = process.env.PORT || '3000';
  const host = process.env.HOST || 'localhost';

  if (!process.env.INSTANCE_NAME) process.env.INSTANCE_NAME = 'tale_platform';

  if (!process.env.SITE_URL) {
    process.env.SITE_URL = `http://${host}${host === 'localhost' ? `:${port}` : ''}`;
  }

  // Sandbox-wobbly-origami plan §4: the spawner runs inside docker (compose)
  // while Convex runs on the host in `bun dev` mode, so storage URLs the
  // action sends to the spawner must use a hostname that resolves to the
  // host from inside the container. `host.docker.internal` is the standard
  // cross-platform alias (Docker Desktop ships it; Linux Docker requires
  // `extra_hosts: ["host.docker.internal:host-gateway"]` which compose.dev.yml
  // already sets on the sandbox service).
  //
  // Override in `services/platform/.env.local` only if your network stack
  // breaks the default — e.g. a VPN/proxy (singbox-tun, tailscale, ...) that
  // hijacks RFC1918 traffic and blocks docker-bridge → host. In that case
  // set the host's LAN IP:
  //
  //   SANDBOX_STORAGE_INTERNAL_BASE_URL=http://192.168.x.y:3210
  //   SANDBOX_HTTP_API_BASE_URL=http://192.168.x.y:3211
  if (!process.env.SANDBOX_STORAGE_INTERNAL_BASE_URL) {
    process.env.SANDBOX_STORAGE_INTERNAL_BASE_URL =
      'http://host.docker.internal:3210';
  }
  if (!process.env.SANDBOX_HTTP_API_BASE_URL) {
    process.env.SANDBOX_HTTP_API_BASE_URL = 'http://host.docker.internal:3211';
  }

  // Root config directory only — Convex derives sub-dirs (agents/workflows/
  // integrations/providers) from TALE_CONFIG_DIR via `convex/*/file_utils.ts`.
  if (!process.env.TALE_CONFIG_DIR) {
    process.env.TALE_CONFIG_DIR = join(repoRoot, 'examples');
  }

  // Immutable seed catalog for new-org scaffolding. Prod sets this in the
  // Docker image (services/convex/Dockerfile copies examples/default →
  // /app/builtin/default; services/platform/Dockerfile sets the env to
  // /app/builtin). Dev has no build step, so default it to whatever
  // TALE_CONFIG_DIR points at — the same tree dev already serves. Without this,
  // `seedDomain` falls back to seeding new orgs from the LIVE `default` org's
  // mutable dir, so an agent deleted in `default` wrongly propagates to every
  // new org. Deriving from TALE_CONFIG_DIR (not a hardcoded `examples`) keeps
  // hermetic setups intact: the E2E stack points TALE_CONFIG_DIR at its own
  // fixtures, and the builtin catalog must follow it rather than leaking the
  // real `examples` agents/providers into freshly scaffolded test orgs.
  if (!process.env.TALE_CONFIG_BUILTIN_DIR) {
    process.env.TALE_CONFIG_BUILTIN_DIR = process.env.TALE_CONFIG_DIR;
  }
}

function ensureInstanceSecret() {
  if (!process.env.INSTANCE_SECRET) {
    console.warn(
      '⚠️  INSTANCE_SECRET not set; using insecure local default.\n   Set INSTANCE_SECRET in .env for production.',
    );
    process.env.INSTANCE_SECRET = 'local-dev-insecure-secret';
  }
}

// Convex functions execute with `NODE_ENV === 'production'` even when the
// host orchestrator is in dev mode, so Better Auth's "default secret in
// production" guard fires and every `/api/auth/*` request returns 500 unless
// `BETTER_AUTH_SECRET` is explicitly set on the Convex deployment.
//
// We populate it here from process.env (which `sync-convex-env-from-dotenv`
// will subsequently push to Convex via its ORCHESTRATOR_MANAGED_KEYS list).
// The fallback value is intentionally long and non-default so Better Auth
// accepts it; it is NOT cryptographically random — production must set a
// real secret via .env / .env.local.
function ensureBetterAuthSecret() {
  if (!process.env.BETTER_AUTH_SECRET) {
    console.warn(
      '⚠️  BETTER_AUTH_SECRET not set; using insecure local default.\n   Set BETTER_AUTH_SECRET in .env for production.',
    );
    process.env.BETTER_AUTH_SECRET =
      'local-dev-better-auth-secret-do-not-use-in-prod-0123456789abcdef';
  }
}

// WebDAV app-password HMAC key. The `createAppPassword` mutation reads this
// from the Convex deployment env via `requireHmacSecret()`, so it must be
// pushed into Convex (see ORCHESTRATOR_MANAGED_KEYS in
// sync-convex-env-from-dotenv.ts). We derive it deterministically from
// INSTANCE_SECRET using the SAME formula as docker-entrypoint.sh
// (sha256(secret || ':webdav-hmac:v1')) so a local dev key is stable across
// restarts and identical to what a containerized run would produce. Must run
// after ensureInstanceSecret() so INSTANCE_SECRET is populated. An explicit
// .env value still wins — we only fill the gap.
function ensureWebdavHmacKey() {
  if (process.env.WEBDAV_APP_PASSWORD_HMAC_KEY) return;
  const secret = process.env.INSTANCE_SECRET ?? '';
  process.env.WEBDAV_APP_PASSWORD_HMAC_KEY = createHash('sha256')
    .update(`${secret}:webdav-hmac:v1`)
    .digest('hex');
}

// Project-secret + guardrails encryption key. `secret_box.ts` /
// `get_secret_key.ts` require a 32-byte hex key (ENCRYPTION_SECRET_HEX) on the
// Convex deployment; without it `setProjectSecret` and guardrails encryption
// throw "ENCRYPTION_SECRET_HEX environment variable is not set". Derive a stable
// 32-byte (64-hex) key from INSTANCE_SECRET — same approach as
// ensureWebdavHmacKey — so dev + E2E exercise secrets with zero setup and the
// key survives restarts (so already-encrypted rows still decrypt). An explicit
// .env value wins; production must set a real key. Run after
// ensureInstanceSecret() so INSTANCE_SECRET is populated.
function ensureEncryptionSecret() {
  if (process.env.ENCRYPTION_SECRET_HEX) return;
  const secret = process.env.INSTANCE_SECRET ?? '';
  process.env.ENCRYPTION_SECRET_HEX = createHash('sha256')
    .update(`${secret}:encryption-secret:v1`)
    .digest('hex');
}

// WebDAV's dev route (vite-plugins/serve-webdav.ts) talks to Convex with the
// deployment ADMIN_KEY to call internal functions; without it the plugin
// disables /dav/* and every request returns 503. Prod derives the key with the
// `generate_key` binary in docker-entrypoint.sh, but the Convex CLI does NOT
// download that binary for local dev — it instead writes the anonymous
// deployment's admin key in cleartext to .convex/local/default/config.json.
// Read it from there so `bun dev` enables WebDAV with zero manual setup. Only
// meaningful for the local backend (the file is a local-CLI artifact); an
// explicit ADMIN_KEY (.env) always wins. MUST run after waitForConvex() so the
// CLI has created the config file.
function ensureLocalAdminKey() {
  if (process.env.ADMIN_KEY) return;
  const configPath = join(platformRoot, '.convex/local/default/config.json');
  if (!existsSync(configPath)) {
    console.warn(
      `[dev] ⚠️  ${configPath} not found; ADMIN_KEY unset, WebDAV /dav/* will 503.`,
    );
    return;
  }
  try {
    const adminKey = JSON.parse(readFileSync(configPath, 'utf8'))?.adminKey;
    if (typeof adminKey !== 'string' || adminKey.length === 0) {
      console.warn(
        '[dev] ⚠️  No adminKey in local Convex config; WebDAV /dav/* will 503.',
      );
      return;
    }
    process.env.ADMIN_KEY = adminKey;
    console.log(
      '[dev] 🔑 ADMIN_KEY loaded from local Convex config — WebDAV /dav/* enabled',
    );
  } catch (err) {
    console.warn(
      `[dev] ⚠️  Failed to read local Convex admin key (${configPath}); WebDAV /dav/* will 503. Underlying: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function loadEnvFiles() {
  // Lowest → highest precedence; a later file's value wins on collision
  // (platform overrides repo, `.local` overrides base).
  const sources = [
    { label: 'repo/.env', path: join(repoRoot, '.env') },
    { label: 'repo/.env.local', path: join(repoRoot, '.env.local') },
    { label: 'platform/.env', path: join(platformRoot, '.env') },
    { label: 'platform/.env.local', path: join(platformRoot, '.env.local') },
  ];

  const mergedEnv: Record<string, string> = {};
  const contributors: string[] = [];
  for (const { label, path } of sources) {
    const vars = parseDotEnv(path);
    const count = Object.keys(vars).length;
    if (count > 0) contributors.push(`${label} (${count})`);
    Object.assign(mergedEnv, vars);
  }

  // Pre-existing process.env wins over .env files — only fill the gaps.
  let loadedCount = 0;
  let skippedCount = 0;
  for (const [key, value] of Object.entries(mergedEnv)) {
    if (key in process.env) {
      skippedCount++;
    } else {
      process.env[key] = value;
      loadedCount++;
    }
  }

  const from = contributors.length > 0 ? contributors.join(', ') : 'none';
  console.log(
    `[dev] 📁 Env from ${from} → ${loadedCount} applied, ${skippedCount} already set`,
  );
}

function runCommand(
  cmd: string,
  args: string[],
  env: Record<string, string> = {},
  cwd: string = platformRoot,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      cwd,
      env: { ...process.env, ...env },
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
    child.on('error', (err) => reject(err));
  });
}

const DEFAULT_CONVEX_PORT = 3210;
const DEFAULT_CONVEX_HOST = '127.0.0.1';
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_AUTO_RESTARTS = 5;
const STABLE_THRESHOLD_MS = 120_000;

/** Resolve the Convex host:port we should probe / proxy. Honours CONVEX_URL
 *  when set so external-mode users can point at a non-default backend. */
function resolveConvexProbeTarget(): {
  host: string;
  port: number;
  url: string;
} {
  const raw = process.env.CONVEX_URL;
  if (raw) {
    try {
      const parsed = new URL(raw);
      const port = parsed.port
        ? Number(parsed.port)
        : parsed.protocol === 'https:'
          ? 443
          : 80;
      return { host: parsed.hostname, port, url: raw };
    } catch {
      console.warn(
        `[dev] ⚠️  CONVEX_URL=${raw} is not a valid URL; falling back to ${DEFAULT_CONVEX_HOST}:${DEFAULT_CONVEX_PORT}`,
      );
    }
  }
  return {
    host: DEFAULT_CONVEX_HOST,
    port: DEFAULT_CONVEX_PORT,
    url: `http://${DEFAULT_CONVEX_HOST}:${DEFAULT_CONVEX_PORT}`,
  };
}

function tcpProbe(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}

/** Fail fast with an actionable message if the app's port is already taken.
 *  Without this (and without Vite's `--strictPort`) Vite quietly falls through
 *  to the next free port — so the orchestrator keeps promising
 *  http://localhost:3000 while the app actually came up on :3001/:3002/etc.
 *  That looks exactly like "I can't reach localhost:3000", so we'd rather stop
 *  here and tell the developer how to free the port. */
async function assertPortFree(port: number): Promise<void> {
  const inUse = await tcpProbe('127.0.0.1', port, 1_000);
  if (!inUse) return;
  throw new Error(
    [
      `Port ${port} is already in use, so the app can't start there.`,
      `   This is usually a previous \`bun run dev\` / \`tale start\` that didn't fully`,
      `   exit, or another process holding the port. Find and stop it, then re-run:`,
      ``,
      `     lsof -nP -iTCP:${port} -sTCP:LISTEN     # show the PID holding it`,
      `     kill <PID>                              # stop it`,
      ``,
      `   Or run the app on a different port:  PORT=3005 bun run dev`,
    ].join('\n'),
  );
}

/** Build `docker compose -f … -f …` argv with the dev overlay chain. */
function dockerComposeArgs(rest: string[]): string[] {
  return ['compose', ...DEV_COMPOSE_FILES.flatMap((f) => ['-f', f]), ...rest];
}

/** Non-fatal docker availability probe. Mirrors the CLI's assertDockerAvailable
 *  (tools/cli/src/lib/actions/start.ts) but resolves a status instead of
 *  throwing, so `bun dev` can warn-and-continue when docker is missing. */
function probeDocker(
  timeoutMs: number,
): Promise<'ok' | 'no-binary' | 'no-daemon'> {
  return new Promise((resolve) => {
    const child = spawn('docker', ['info'], { stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve('no-daemon');
    }, timeoutMs);
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve(err.code === 'ENOENT' ? 'no-binary' : 'no-daemon');
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? 'ok' : 'no-daemon');
    });
  });
}

/** Probe the bifrost gateway on its host-published loopback port until it
 *  accepts connections — this is the axis that breaks when the dev overlay's
 *  port binding is missing. Honours BIFROST_URL; warn-and-continue on timeout. */
async function waitForBifrostGateway(timeoutMs = 30_000): Promise<void> {
  let host = '127.0.0.1';
  let port = 8080;
  const raw = process.env.BIFROST_URL;
  if (raw) {
    try {
      const u = new URL(raw);
      host = u.hostname || host;
      port = u.port ? Number(u.port) : port;
    } catch {
      console.warn(
        `[dev] ⚠️  BIFROST_URL=${raw} is not a valid URL; probing ${host}:${port}`,
      );
    }
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await tcpProbe(host, port, 2_000)) {
      console.log(`[dev] ✅ Bifrost gateway reachable at ${host}:${port}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.warn(
    `[dev] ⚠️  Bifrost gateway not reachable at ${host}:${port} within ${timeoutMs / 1000}s — external-agent turns may fail with "fetch failed".`,
  );
}

/** Bring up the docker backing services the host `bun dev` depends on, WITH the
 *  dev overlays. Host bun dev runs Convex + Vite on the host, but the LLM
 *  gateway (bifrost), sandbox spawner, db and knowledge-db run in docker. The
 *  base compose.yml publishes NO bifrost port (prod posture) — only
 *  compose.bifrost.dev.yml maps 127.0.0.1:8080 — so a plain `docker compose up`
 *  silently drops the loopback binding and the host Convex action can't reach
 *  the gateway (every external-agent turn then dies with "fetch failed"). Doing
 *  the bring-up here, with the overlay chain, makes `bun dev` self-sufficient
 *  and keeps the port from drifting.
 *
 *  Idempotent: an already-overlay stack recreates nothing; after a prior bare
 *  `up` it recreates whatever config drifted (bifrost gains its port, the rest
 *  gain source mounts / extra_hosts) — the intended convergence to dev config.
 *
 *  Docker absent is NON-FATAL: warn with the concrete side-effects and let the
 *  app come up anyway (pure frontend/Convex work doesn't need the gateway). */
async function ensureDockerDependencies(): Promise<void> {
  // The hermetic E2E stack (playwright.config.ts) is anonymous-Convex + mock
  // LLM with "no external services" — the backing images aren't built in the
  // E2E CI job, so `docker compose up` can only ever fail there. Attempting it
  // wastes the cold-boot budget and destabilizes the Convex pre-warm that
  // follows. Let the E2E webServer opt out explicitly.
  if (/^(1|true|yes|on)$/i.test(process.env.TALE_DEV_SKIP_DOCKER ?? '')) {
    console.log(
      '[dev] ⏭  Skipping docker backing services (TALE_DEV_SKIP_DOCKER set)',
    );
    return;
  }

  // Stop spurious container churn on every `bun dev`. The db/sandbox/
  // sandbox-egress services have `build:` blocks with `pull_policy: build`, so
  // `docker compose up` runs their build step on every bring-up. Under buildx
  // with the containerd image store (Docker Desktop default), BuildKit attaches
  // a provenance attestation by default — its metadata is non-deterministic, so
  // even a 100%-cached build re-exports a NEW image manifest digest. compose
  // then sees the service image no longer matches the running container's image
  // and recreates the container — every single run. (External-image services
  // like bifrost/convex-relay are never built, so they stay put — which is why
  // only the build-services churned.) Disabling the default attestation makes
  // the cached build reproduce a stable image ID, so an already-up stack
  // converges to a no-op. Scoped to dev: CI/release builds run in their own
  // processes and keep provenance for supply-chain integrity. Explicit override
  // still wins.
  process.env.BUILDX_NO_DEFAULT_ATTESTATIONS ??= '1';

  const status = await probeDocker(10_000);
  if (status !== 'ok') {
    const why =
      status === 'no-binary'
        ? 'Docker is not installed'
        : 'Docker daemon is not running / unreachable';
    console.warn('');
    console.warn(`[dev] ⚠️  ${why} — skipping docker backing services.`);
    console.warn('[dev]    Side-effects until you start them:');
    console.warn(
      '[dev]      • LLM gateway (bifrost) unreachable → external agents / Claude Code chat fail with "fetch failed"',
    );
    console.warn(
      '[dev]      • sandbox + sandbox-egress down → agent code execution / tool runs unavailable',
    );
    console.warn(
      '[dev]      • db + knowledge-db down → knowledge base / RAG search unavailable',
    );
    console.warn('[dev]    Start them once Docker is available with:');
    console.warn(
      `[dev]      docker ${dockerComposeArgs(['up', '-d', ...DEV_DOCKER_SERVICES]).join(' ')}`,
    );
    console.warn('');
    return;
  }

  console.log(
    `[dev] 🐳 Bringing up docker backing services (${DEV_DOCKER_SERVICES.join(', ')})...`,
  );
  try {
    await runCommand(
      'docker',
      dockerComposeArgs(['up', '-d', ...DEV_DOCKER_SERVICES]),
      {},
      repoRoot,
    );
    console.log('[dev] ✅ Docker backing services up');
  } catch (err) {
    // The usual cause is a missing locally-built image (db/sandbox/
    // sandbox-egress have `build:` blocks). Rather than warn-and-print a
    // command for the developer to run by hand, retry once WITH `--build` so a
    // fresh checkout reaches a working stack on the first `bun dev`. The build
    // is slow (minutes cold), so announce it; still non-fatal if it fails too.
    console.warn(
      `[dev] ⚠️  docker compose up failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.log(
      '[dev] 🔨 Retrying with --build (images may be missing — first build can take a few minutes)...',
    );
    try {
      await runCommand(
        'docker',
        dockerComposeArgs(['up', '--build', '-d', ...DEV_DOCKER_SERVICES]),
        {},
        repoRoot,
      );
      console.log('[dev] ✅ Docker backing services built and up');
    } catch (buildErr) {
      console.warn(
        `[dev] ⚠️  docker compose up --build also failed (continuing): ${buildErr instanceof Error ? buildErr.message : String(buildErr)}`,
      );
      console.warn(
        `[dev]    Build them manually to see full output: docker ${dockerComposeArgs(['up', '--build', '-d', ...DEV_DOCKER_SERVICES]).join(' ')}`,
      );
      return;
    }
  }

  await waitForBifrostGateway();
}

/** Probe the Better Auth HTTP surface (served by the Convex site proxy on
 *  :3211) until `/api/auth/ok` answers 200. This is a true end-to-end auth
 *  readiness check: it proves the http router is pushed AND the better-auth
 *  handler can execute with its env (BETTER_AUTH_SECRET etc.). On the FIRST
 *  run in a clean repo the browser used to race this bootstrap — the page's
 *  initial session/token fetches failed, the auth provider latched the
 *  failure, and the app sat in skeletons until a manual reload. Probing
 *  before Vite starts means the app is never reachable before auth is.
 *  Warn-and-continue on timeout: a genuinely broken auth route fails loudly
 *  in the browser anyway, and the client now retries transient failures. */
async function waitForAuthRoutes(timeoutMs = 90_000): Promise<void> {
  const convexBase =
    process.env.CONVEX_URL ||
    `http://${DEFAULT_CONVEX_HOST}:${DEFAULT_CONVEX_PORT}`;
  // Derive the Convex site-proxy origin (:3211) from CONVEX_URL. Parse with
  // URL and set the port explicitly so a trailing slash or path on CONVEX_URL
  // (e.g. `http://127.0.0.1:3210/`) can't defeat a `:\d+$` swap and leave the
  // probe pointed at the backend port — which would block startup for the full
  // timeout despite auth being healthy on :3211.
  const siteBase =
    process.env.CONVEX_SITE_PROXY_URL ||
    (() => {
      const u = new URL(convexBase);
      u.port = '3211';
      u.pathname = '';
      u.search = '';
      u.hash = '';
      return u.toString();
    })();
  const url = `${siteBase.replace(/\/$/, '')}/api/auth/ok`;
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response yet';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (res.ok) {
        console.log('[dev] ✅ Auth routes ready');
        return;
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      // Expected while the backend is still warming — remember the failure
      // for the timeout warning instead of spamming once per second.
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  console.warn(
    `[dev] ⚠️  Auth routes did not answer at ${url} within ${timeoutMs / 1000}s (last: ${lastError}) — continuing; the first page load may need the in-app auth retry.`,
  );
}

/** Poll until the dev server is actually accepting connections, then print one
 *  unmistakable READY banner. This matters because (a) the log line printed
 *  just before spawning Vite only *promises* the URL — the socket isn't bound
 *  yet — and (b) under `turbo run dev` the platform is the MAIN app but the
 *  SLOWEST to start (it waits on the Convex pre-warm), coming up ~20-60s after
 *  the lighter web/docs servers print their own "Local: …" lines. Without a
 *  distinct post-bind signal, developers open :3000 too early, hit
 *  connection-refused, and assume it's broken. */
async function announceWhenReady(port: number, url: string): Promise<void> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await tcpProbe('127.0.0.1', port, 1_000)) {
      console.log('');
      console.log(
        '[dev] ════════════════════════════════════════════════════════',
      );
      console.log(
        `[dev]  ✅  READY in ${sinceBoot()} — open ${url} in your browser`,
      );
      console.log(
        '[dev] ════════════════════════════════════════════════════════',
      );
      console.log('');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function killProcessTree(
  proc: ChildProcess | null,
  signal: string = 'SIGKILL',
): Promise<void> {
  return new Promise((resolve) => {
    if (!proc || proc.killed || !proc.pid) {
      resolve();
      return;
    }
    const onExit = () => resolve();
    proc.once('exit', onExit);
    kill(proc.pid, signal, (err) => {
      if (err) {
        proc.removeListener('exit', onExit);
        resolve();
      }
    });
  });
}

async function main() {
  // Phase 2 (split architecture): if CONVEX_EXTERNAL=true, the developer has
  // a convex backend running externally (e.g., `docker compose up convex`).
  // Skip spawning a local `bunx convex dev` and just run Vite with env sync.
  // Accept any case-variant truthy value so CONVEX_EXTERNAL=1 / True / yes work.
  const useExternalConvex = /^(1|true|yes|on)$/i.test(
    process.env.CONVEX_EXTERNAL ?? '',
  );

  console.log('[dev] 🚀 Starting development environment...');
  if (useExternalConvex) {
    console.log(
      '[dev] 🌐 Using EXTERNAL Convex backend (CONVEX_EXTERNAL=true)',
    );
    console.log(
      `[dev]    Target: ${process.env.CONVEX_URL || 'http://127.0.0.1:3210'}`,
    );
  } else {
    console.log(
      '[dev] 🔧 Using LOCAL development mode for Convex (anonymous mode)',
    );
    console.log(
      '[dev] ✅ Login prompt automatically skipped - running in local-only mode',
    );
    console.log('[dev] 💡 No cloud account required - all data stays local');
  }
  console.log('[dev] 💡 Press Ctrl+C to stop all services');
  console.log('');

  let convexProcess: ChildProcess | null = null;
  let viteProcess: ChildProcess | null = null;
  let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  let shuttingDown = false;
  let restartCount = 0;
  let convexReadyAt = 0;
  let consecutiveFailures = 0;
  let restarting = false;

  try {
    loadEnvFiles();
    console.log('');

    envNormalizeCommon();
    ensureInstanceSecret();
    ensureBetterAuthSecret();
    ensureWebdavHmacKey();
    ensureEncryptionSecret();
    const deployment = process.env.CONVEX_DEPLOYMENT;
    const hasLocalDeployment = deployment?.startsWith('anonymous:');
    if (deployment && !hasLocalDeployment) {
      console.log(
        '[dev] ℹ️  Clearing cloud CONVEX_DEPLOYMENT for local Convex dev',
      );
      delete process.env.CONVEX_DEPLOYMENT;
    } else if (hasLocalDeployment) {
      console.log(`[dev] ℹ️  Reusing local deployment: ${deployment}`);
    }

    // Run every local Convex CLI invocation in anonymous (local-only) mode.
    // Besides skipping the cloud login flow, an explicit
    // CONVEX_AGENT_MODE=anonymous also SUPPRESSES the CLI's repeated
    //   "Run `npx convex login` at any time to create an account ..."
    // hint — the CLI only prints that when this var is *not* 'anonymous'
    // (see convex/src/cli/lib/init.ts). Setting it on process.env means the
    // pre-warm, the spawned `convex dev`, env-sync and codegen all inherit it.
    // We never force it in external mode — that backend may be a real
    // cloud/self-hosted deployment where anonymous mode would be wrong.
    if (!useExternalConvex) {
      process.env.CONVEX_AGENT_MODE = 'anonymous';
    }
    console.log('[dev] ✅ Environment normalized (env.sh parity)');

    // Port + URL are fully resolved now (envNormalizeCommon set PORT/SITE_URL),
    // so derive the app's address from those — honouring PORT/SITE_URL
    // overrides instead of hardcoding localhost:3000.
    const appPort = Number(process.env.PORT || '3000');
    const appUrl = process.env.SITE_URL || `http://localhost:${appPort}`;

    // Fail fast (before the slow Convex pre-warm) if the app's port is taken —
    // otherwise Vite silently moves to another port and every "${appUrl}"
    // message we print becomes a lie.
    await assertPortFree(appPort);
    console.log(`[dev] ✅ Port ${appPort} is free`);

    // Set expectations before the slow part: the app (the MAIN server) comes up
    // LAST, after Convex. Until the READY banner, ${appUrl} refusing
    // connections is normal — not a failure.
    console.log(
      `[dev] ⏳ Heads up: the app on ${appUrl} starts LAST (after Convex).`,
    );
    console.log(
      '[dev]    A cold start can take 30-90s; until the "READY" banner appears,',
    );
    console.log(
      `[dev]    connection-refused on ${appUrl} is expected — not a failure.`,
    );
    console.log(
      '[dev]    (Under `bun run dev`, the lighter web/docs servers come up first.)',
    );

    // Bring up the docker backing stack (gateway, sandbox, db, knowledge-db)
    // WITH the dev overlays before Convex/Vite. Host bun dev runs Convex+Vite on
    // the host but depends on these in docker; the bifrost gateway in particular
    // has no published port in base compose.yml, so without this an external
    // agent turn dies with "fetch failed". Runs in BOTH local and external
    // Convex modes; non-fatal if docker is absent (warns + continues).
    await ensureDockerDependencies();

    // Inherits CONVEX_AGENT_MODE=anonymous from process.env (set above) in
    // local mode, so the spawned backend runs anonymous and stays quiet.
    const convexEnv = { ...process.env };

    function spawnConvex() {
      convexProcess = spawn('npx', ['convex', 'dev'], {
        stdio: 'inherit',
        cwd: platformRoot,
        env: convexEnv,
      });
      convexProcess.on('exit', (code) => {
        if (shuttingDown || restarting) return;
        console.log(`[dev] Convex exited with code ${code}`);
        void shutdown();
      });
    }

    // E2E mitigation: on the shared 4-vCPU CI runner the local backend competes
    // with Vite + the browser for CPU and blows its hard ~1s function timeout.
    // Give `convex-local-backend` a scheduling-priority edge so its UDFs win the
    // race. Best-effort and E2E/Linux-only — never blocks or fails the boot
    // (renice needs CAP_SYS_NICE, available via passwordless sudo on GH runners;
    // a no-op everywhere else). Pairs with the sub-hourly cron skip in crons.ts.
    function prioritizeConvexForE2E() {
      if (process.env.TALE_E2E !== '1' || process.platform !== 'linux') return;
      try {
        const found = spawnSync('pgrep', ['-f', 'convex-local-backend'], {
          encoding: 'utf8',
        });
        const pids = (found.stdout ?? '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        if (pids.length === 0) return;
        spawnSync('sudo', ['-n', 'renice', '-n', '-10', '-p', ...pids], {
          stdio: 'ignore',
        });
        console.log(
          `[dev] ⚡ Raised Convex backend priority for E2E (pids: ${pids.join(', ')})`,
        );
      } catch {
        // Best-effort only; starvation mitigation, not a correctness gate.
      }
    }

    async function waitForConvex() {
      const target = resolveConvexProbeTarget();
      console.log(
        `[dev] ⏳ Waiting for Convex backend at ${target.host}:${target.port}...`,
      );
      try {
        await runCommand('bunx', [
          'wait-on',
          `tcp:${target.host}:${target.port}`,
          '--timeout',
          '180000',
          '--interval',
          '250',
        ]);
      } catch (err) {
        // Re-throw with a clearer message for the external case so the
        // developer immediately understands which target failed.
        throw new Error(
          useExternalConvex
            ? `External Convex backend at ${target.url} is not reachable. Is it running? (set CONVEX_URL to override.) Underlying: ${err instanceof Error ? err.message : String(err)}`
            : `Local Convex backend at ${target.host}:${target.port} did not start within 180s. Underlying: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
      convexReadyAt = Date.now();
      consecutiveFailures = 0;
      console.log('[dev] ✅ Convex backend is ready!');
      prioritizeConvexForE2E();
    }

    async function restartConvex() {
      if (shuttingDown || restarting) return;
      // We don't own the external backend's process; restart is a no-op.
      if (useExternalConvex) {
        console.warn(
          '[dev] ⚠️  External Convex appears unreachable; cannot restart it from here. Check the external backend and re-run `tale start` / `bun run dev` if needed.',
        );
        return;
      }
      restarting = true;

      if (convexReadyAt && Date.now() - convexReadyAt > STABLE_THRESHOLD_MS) {
        restartCount = 0;
      }

      if (restartCount >= MAX_AUTO_RESTARTS) {
        console.error(
          `[dev] Convex failed ${MAX_AUTO_RESTARTS} times in quick succession, shutting down`,
        );
        restarting = false;
        void shutdown();
        return;
      }

      restartCount++;
      console.warn(
        `[dev] Convex unresponsive, restarting... (attempt ${restartCount}/${MAX_AUTO_RESTARTS})`,
      );

      try {
        await killProcessTree(convexProcess, 'SIGKILL');
        spawnConvex();
        await waitForConvex();
        console.log('[dev] Convex recovered successfully');
      } catch (err) {
        console.error(
          '[dev] Convex failed to recover:',
          err instanceof Error ? err.message : err,
        );
        restarting = false;
        void shutdown();
        return;
      }

      restarting = false;
    }

    function startHealthCheck() {
      const target = resolveConvexProbeTarget();
      healthCheckTimer = setInterval(async () => {
        if (shuttingDown || restarting) return;

        const alive = await tcpProbe(
          target.host,
          target.port,
          HEALTH_CHECK_TIMEOUT_MS,
        );

        if (alive) {
          consecutiveFailures = 0;
          return;
        }

        // Local-mode only: skip if our spawned process already exited (avoids
        // double-counting during shutdown). External mode has no process to
        // inspect, so we just count failures and warn.
        if (
          !useExternalConvex &&
          (convexProcess?.killed || convexProcess?.exitCode != null)
        )
          return;

        consecutiveFailures++;
        console.warn(
          `[dev] Convex health check failed at ${target.host}:${target.port} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`,
        );

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          consecutiveFailures = 0;
          void restartConvex();
        }
      }, HEALTH_CHECK_INTERVAL_MS);

      healthCheckTimer.unref();
    }

    if (useExternalConvex) {
      console.log(
        '[dev] ⏭  Skipping local Convex spawn (CONVEX_EXTERNAL=true)',
      );
      await waitForConvex();
    } else {
      // Make Convex `node.externalPackages` resolvable from
      // services/platform/node_modules (they're hoisted to the repo root in
      // this bun workspace, where Convex's bundler can't find them). Without
      // this the heavy node-only libs get bundled inline and the push fails
      // (canvas.node / jsdom default-stylesheet / module-size). Idempotent.
      try {
        await runCommand('bun', ['scripts/link-convex-externals.ts']);
      } catch (err) {
        console.warn(
          `[dev] ⚠️  Failed to link Convex external packages; the push may fail. Underlying: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Preflight: `npx convex dev --once` absorbs slow first-run work
      // (binary download, SQLite bootstrap, migrations, function push). We use
      // `npx` (not `bunx`) so the Convex CLI runs under Node, which is what
      // upstream tests and supports — under Bun, child_process/fetch timing
      // quirks can blow the CLI's internal 30s port-ready window even when the
      // backend is actually coming up fine.
      console.log(
        '[dev] 🧰 Pre-warming Convex backend (npx convex dev --once)...',
      );
      try {
        // CONVEX_AGENT_MODE=anonymous is already on process.env (local mode),
        // which runCommand forwards — so the pre-warm runs anonymous too.
        await runCommand('npx', ['convex', 'dev', '--once']);
        console.log(`[dev] ✅ Convex backend pre-warmed (${sinceBoot()})`);
      } catch (err) {
        throw new Error(
          `Convex preflight (npx convex dev --once) failed. This usually means a stale backend is holding port 3210, or the local deployment state is corrupt. Try: lsof -i :3210 and kill any leftover 'convex-local-backend' processes. Underlying: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      console.log('[dev] ⏳ Starting Convex backend...');
      spawnConvex();
      await waitForConvex();
    }

    // Re-read CONVEX_DEPLOYMENT from .env.local in case `convex dev` wrote it
    // after our initial loadEnvFiles() call (happens on first run with fresh DB)
    const platformEnvLocalPath = join(platformRoot, '.env.local');
    const freshEnv = parseDotEnv(platformEnvLocalPath);
    if (freshEnv.CONVEX_DEPLOYMENT && !process.env.CONVEX_DEPLOYMENT) {
      process.env.CONVEX_DEPLOYMENT = freshEnv.CONVEX_DEPLOYMENT;
      console.log(
        `[dev] ℹ️  Picked up new deployment: ${freshEnv.CONVEX_DEPLOYMENT}`,
      );
    }

    // Load the local deployment's admin key now that `convex dev` has written
    // it — enables the WebDAV /dav/* route in dev. External backends supply
    // ADMIN_KEY via .env instead (no local config file to read).
    if (!useExternalConvex) {
      ensureLocalAdminKey();
    }

    console.log('[dev] 🔄 Syncing environment variables...');
    try {
      await runCommand('bun', ['scripts/sync-convex-env-from-dotenv.ts']);

      // Sync TALE_CONFIG_DIR and derived dirs explicitly (set dynamically, not in .env files)
      const taleConfigDir = process.env.TALE_CONFIG_DIR;
      if (taleConfigDir) {
        await runCommand('npx', [
          'convex',
          'env',
          'set',
          `TALE_CONFIG_DIR=${taleConfigDir}`,
        ]);
        console.log(`[dev] ✅ TALE_CONFIG_DIR=${taleConfigDir}`);
      }

      // Same treatment for the seed catalog (set dynamically in
      // envNormalizeCommon, not in .env files). The scaffold reads it from the
      // Convex deployment env, so it must be pushed here too — otherwise dev
      // new-org seeding silently falls back to the live `default` org.
      const taleBuiltinDir = process.env.TALE_CONFIG_BUILTIN_DIR;
      if (taleBuiltinDir) {
        await runCommand('npx', [
          'convex',
          'env',
          'set',
          `TALE_CONFIG_BUILTIN_DIR=${taleBuiltinDir}`,
        ]);
        console.log(`[dev] ✅ TALE_CONFIG_BUILTIN_DIR=${taleBuiltinDir}`);
      }

      // Convex derives AGENTS_DIR / WORKFLOWS_DIR / INTEGRATIONS_DIR /
      // PROVIDERS_DIR from TALE_CONFIG_DIR via convex/*/file_utils.ts.
      console.log('[dev] ✅ Environment variables synced successfully');
    } catch (err) {
      console.warn(
        '[dev] ⚠️  Env sync had errors:',
        err instanceof Error ? err.message : err,
      );
    }

    console.log('[dev] 🔄 Running code generation...');
    await runCommand('npx', ['convex', 'codegen']);
    console.log(`[dev] ✅ Code generation completed (${sinceBoot()})`);

    console.log('[dev] ⏳ Waiting for auth routes to serve...');
    await waitForAuthRoutes();

    // Preserve any existing CONVEX_URL the user set (external mode); only
    // synthesize one for local mode where we own the spawned backend.
    const convexUrl =
      process.env.CONVEX_URL ||
      process.env.NEXT_PUBLIC_CONVEX_URL ||
      `http://${DEFAULT_CONVEX_HOST}:${DEFAULT_CONVEX_PORT}`;
    process.env.CONVEX_URL = convexUrl;
    console.log(`[dev] ✅ Set CONVEX_URL=${convexUrl} for Vite proxy`);

    const port = String(appPort);

    // Prod-build serve mode (E2E): serve a production build via `vite preview`
    // instead of the dev server. `vite dev` transpiles on the fly, which is the
    // dominant CPU consumer — on the 4-vCPU CI runner it starved the local
    // Convex backend hard enough to blow its 1s function-execution timeout in
    // floods and flake the suite. A pre-built `dist/` removes that load: preview
    // just serves static assets and proxies Convex (see vite.config.ts
    // `preview.proxy` + the plugins' `configurePreviewServer` hooks). Gated to
    // E2E so `bun run dev` keeps its HMR loop.
    const serveBuild = /^(1|true|yes|on)$/i.test(
      process.env.TALE_E2E_SERVE_BUILD ?? '',
    );

    if (serveBuild) {
      const distIndex = join(platformRoot, 'dist', 'index.html');
      if (!existsSync(distIndex)) {
        console.log('[dev] 🏗  Building production bundle (vite build)...');
        await runCommand('bun', ['--bun', 'vite', 'build']);
        console.log(`[dev] ✅ Build complete (${sinceBoot()})`);
      } else {
        console.log('[dev] ♻️  Reusing existing dist/ (skipping vite build)');
      }
      console.log(
        '[dev] 🚀 Starting Vite preview (serving production build)...',
      );
      console.log(
        `[dev] ⏳ ${appUrl} is NOT reachable yet — wait for the "READY" banner below.`,
      );
      console.log('');
      // No `--bun`: preview proxies Convex (preview.proxy in vite.config.ts),
      // and Vite 7's proxy calls `socket.destroySoon`, which Bun 1.3.x's
      // runtime lacks — the same reason `vite dev` runs on Node below.
      viteProcess = spawn(
        'bun',
        [
          'vite',
          'preview',
          '--port',
          port,
          '--strictPort',
          '--host',
          '0.0.0.0',
        ],
        { stdio: 'inherit', cwd: platformRoot, env: process.env },
      );
    } else {
      console.log('[dev] 🚀 Starting TanStack Start dev server (compiling)...');
      console.log(
        `[dev] ⏳ ${appUrl} is NOT reachable yet — wait for the "READY" banner below.`,
      );
      console.log(
        `[dev]    (Once ready it is also served on your LAN IP on port ${port}.)`,
      );
      console.log('');

      // Run Vite on Node.js (no --bun flag): Bun 1.3.x lacks socket.destroySoon,
      // which Vite 7's dev proxy requires. Build/preview still use --bun.
      // `--strictPort`: if 3000 is taken, FAIL loudly instead of silently moving
      // to the next free port (which would break SITE_URL, the Convex proxy, and
      // every "localhost:3000" message). The assertPortFree() preflight above
      // catches this earlier with a friendlier message; this is the safety net.
      viteProcess = spawn(
        'bun',
        ['vite', 'dev', '--port', port, '--strictPort', '--host', '0.0.0.0'],
        {
          stdio: 'inherit',
          cwd: platformRoot,
          env: process.env,
        },
      );
    }

    // Print one unmistakable READY banner once Vite has actually bound the
    // port — the messages above only promise the URL.
    void announceWhenReady(appPort, appUrl);

    async function shutdown() {
      if (shuttingDown) return;
      shuttingDown = true;

      if (healthCheckTimer) clearInterval(healthCheckTimer);

      console.log('\n[dev] 👋 Shutting down...');

      await Promise.all([
        killProcessTree(convexProcess, 'SIGTERM'),
        killProcessTree(viteProcess, 'SIGTERM'),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      console.log('[dev] ✅ All processes stopped');
      process.exit(0);
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    viteProcess.on('exit', (code) => {
      if (shuttingDown) return;
      console.log(`[dev] TanStack Start exited with code ${code}`);
      void shutdown();
    });

    startHealthCheck();
    console.log(
      `[dev] 🏥 Convex health check active (every ${HEALTH_CHECK_INTERVAL_MS / 1000}s)`,
    );

    await new Promise(() => {});
  } catch (err) {
    console.error(
      '[dev] ❌ Development environment failed:',
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[dev] ❌ Orchestrator error:', err);
  process.exit(1);
});
