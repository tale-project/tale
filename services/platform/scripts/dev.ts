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

import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import process from 'node:process';

import kill from 'tree-kill';

const platformRoot = join(import.meta.dir, '..');
const repoRoot = join(import.meta.dir, '..', '..', '..');

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
  const repoEnvPath = join(repoRoot, '.env');
  const repoEnvLocalPath = join(repoRoot, '.env.local');
  const platformEnvPath = join(platformRoot, '.env');
  const platformEnvLocalPath = join(platformRoot, '.env.local');

  console.log('[dev] 📁 Loading environment variables...');
  console.log(`[dev] 🔍 Checking paths:`);
  console.log(
    `[dev]   - Repo .env: ${repoEnvPath} (exists: ${existsSync(repoEnvPath)})`,
  );
  console.log(
    `[dev]   - Repo .env.local: ${repoEnvLocalPath} (exists: ${existsSync(repoEnvLocalPath)})`,
  );
  console.log(
    `[dev]   - Platform .env: ${platformEnvPath} (exists: ${existsSync(platformEnvPath)})`,
  );
  console.log(
    `[dev]   - Platform .env.local: ${platformEnvLocalPath} (exists: ${existsSync(platformEnvLocalPath)})`,
  );

  const repoBaseEnv = parseDotEnv(repoEnvPath);
  const repoLocalEnv = parseDotEnv(repoEnvLocalPath);
  const platformBaseEnv = parseDotEnv(platformEnvPath);
  const platformLocalEnv = parseDotEnv(platformEnvLocalPath);

  console.log(`[dev] 📊 Loaded from files:`);
  console.log(`[dev]   - Repo .env: ${Object.keys(repoBaseEnv).length} vars`);
  console.log(
    `[dev]   - Repo .env.local: ${Object.keys(repoLocalEnv).length} vars`,
  );
  console.log(
    `[dev]   - Platform .env: ${Object.keys(platformBaseEnv).length} vars`,
  );
  console.log(
    `[dev]   - Platform .env.local: ${Object.keys(platformLocalEnv).length} vars`,
  );

  const mergedEnv = {
    ...repoBaseEnv,
    ...repoLocalEnv,
    ...platformBaseEnv,
    ...platformLocalEnv,
  };

  console.log(
    `[dev] 📦 Total unique vars after merge: ${Object.keys(mergedEnv).length}`,
  );

  let loadedCount = 0;
  let skippedCount = 0;
  for (const [key, value] of Object.entries(mergedEnv)) {
    if (!(key in process.env)) {
      process.env[key] = value;
      loadedCount++;
    } else {
      skippedCount++;
    }
  }

  console.log(
    `[dev] ✅ Loaded ${loadedCount} environment variables from .env files`,
  );
  if (skippedCount > 0) {
    console.log(
      `[dev] ⏭️  Skipped ${skippedCount} variables (already in process.env)`,
    );
  }
  console.log(
    `[dev] 📍 Priority: services/platform/.env.local > services/platform/.env > repo root/.env.local > repo root/.env`,
  );
}

function runCommand(
  cmd: string,
  args: string[],
  env: Record<string, string> = {},
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      cwd: platformRoot,
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
      console.log(`[dev]  ✅  READY — open ${url} in your browser`);
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
        console.log('[dev] ✅ Convex backend pre-warmed');
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
    console.log('[dev] ✅ Code generation completed');

    // Preserve any existing CONVEX_URL the user set (external mode); only
    // synthesize one for local mode where we own the spawned backend.
    const convexUrl =
      process.env.CONVEX_URL ||
      process.env.NEXT_PUBLIC_CONVEX_URL ||
      `http://${DEFAULT_CONVEX_HOST}:${DEFAULT_CONVEX_PORT}`;
    process.env.CONVEX_URL = convexUrl;
    console.log(`[dev] ✅ Set CONVEX_URL=${convexUrl} for Vite proxy`);

    const port = String(appPort);

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
