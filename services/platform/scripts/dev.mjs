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

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import kill from 'tree-kill';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const platformRoot = join(__dirname, '..');
// Repository root is two levels up from services/platform
const repoRoot = join(__dirname, '..', '..', '..');

/**
 * Parse a .env file and return key-value pairs
 */
function parseDotEnv(filePath) {
  const result = {};
  if (!existsSync(filePath)) return result;
  const raw = readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes if present
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

/**
 * Normalize and inject environment variables similar to services/platform/env.sh
 * Does not overwrite already-set values.
 */
function envNormalizeCommon() {
  // TanStack Start/server basics
  // Force development mode for local dev
  process.env.NODE_ENV = 'development';
  if (!process.env.PORT) process.env.PORT = '3000';
  if (!process.env.HOSTNAME) process.env.HOSTNAME = '0.0.0.0';

  // Domain configuration
  const port = process.env.PORT || '3000';
  const host = process.env.HOST || 'localhost';

  // Database: POSTGRES_URL left as-is if provided

  // Convex instance configuration
  if (!process.env.INSTANCE_NAME) process.env.INSTANCE_NAME = 'tale_platform';
  // INSTANCE_SECRET handled by ensureInstanceSecret()

  // AI providers: OPENAI_API_KEY left as-is if provided

  // SITE_URL is the canonical base URL - all other URLs are derived from it in code
  // For local development, default to http://localhost:PORT if not set
  if (!process.env.SITE_URL) {
    process.env.SITE_URL = `http://${host}${host === 'localhost' ? `:${port}` : ''}`;
  }
}

/**
 * Ensure INSTANCE_SECRET exists for local dev; warn if using insecure default.
 */
function ensureInstanceSecret() {
  if (!process.env.INSTANCE_SECRET) {
    console.warn(
      '⚠️  INSTANCE_SECRET not set; using insecure local default.\n   Set INSTANCE_SECRET in .env for production.',
    );
    process.env.INSTANCE_SECRET = 'local-dev-insecure-secret';
  }
}

/**
 * Load environment variables from repository root and services/platform .env and .env.local files
 * and merge them into process.env (without overwriting existing values)
 * Priority (highest to lowest): services/platform/.env.local > services/platform/.env > repo root/.env.local > repo root/.env
 */
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

  // Read all .env files
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

  // Merge with priority: services/platform/.env.local > services/platform/.env > repo root/.env.local > repo root/.env
  const mergedEnv = {
    ...repoBaseEnv,
    ...repoLocalEnv,
    ...platformBaseEnv,
    ...platformLocalEnv,
  };

  console.log(
    `[dev] 📦 Total unique vars after merge: ${Object.keys(mergedEnv).length}`,
  );

  // Apply to process.env (but don't overwrite existing values)
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

/**
 * Run a command and wait for it to complete
 */
function runCommand(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
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

// Health check & auto-restart configuration
const CONVEX_PORT = 3210;
const CONVEX_HOST = '127.0.0.1';
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_AUTO_RESTARTS = 5;
const STABLE_THRESHOLD_MS = 120_000;

/**
 * TCP probe — resolves true if port accepts a connection, false otherwise.
 */
function tcpProbe(host, port, timeoutMs) {
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

/**
 * Kill a process tree and wait for it to exit.
 */
function killProcessTree(proc, signal = 'SIGKILL') {
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
  console.log('[dev] 🚀 Starting development environment...');
  console.log(
    '[dev] 🔧 Using LOCAL development mode for Convex (anonymous mode)',
  );
  console.log(
    '[dev] ✅ Login prompt automatically skipped - running in local-only mode',
  );
  console.log('[dev] 💡 No cloud account required - all data stays local');
  console.log('[dev] 💡 Press Ctrl+C to stop all services');
  console.log('');

  let convexProcess = null;
  let viteProcess = null;
  let healthCheckTimer = null;
  let shuttingDown = false;
  let restartCount = 0;
  let convexReadyAt = 0;
  let consecutiveFailures = 0;
  let restarting = false;

  try {
    // Step 0: Load environment variables from repository root
    loadEnvFiles();
    console.log('');

    // Step 0.5: Normalize and inject derived env vars (mirror env.sh)
    envNormalizeCommon();
    ensureInstanceSecret();
    // Clear non-local CONVEX_DEPLOYMENT values (e.g. cloud deployments) so
    // Convex runs without requiring a cloud login. Preserve anonymous (local)
    // deployments so the backend reconnects to the same instance across restarts.
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
    console.log('[dev] ✅ Environment normalized (env.sh parity)');

    // Build Convex environment once (reused across restarts)
    const convexEnv = { ...process.env };
    if (!hasLocalDeployment) {
      convexEnv.CONVEX_AGENT_MODE = 'anonymous';
    }

    function spawnConvex() {
      convexProcess = spawn('bunx', ['convex', 'dev'], {
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
      console.log('[dev] ⏳ Waiting for Convex backend on port 3210...');
      await runCommand('bunx', [
        'wait-on',
        `tcp:${CONVEX_HOST}:${CONVEX_PORT}`,
        '--timeout',
        '180000',
        '--interval',
        '250',
      ]);
      convexReadyAt = Date.now();
      consecutiveFailures = 0;
      console.log('[dev] ✅ Convex backend is ready!');
    }

    async function restartConvex() {
      if (shuttingDown || restarting) return;
      restarting = true;

      // Reset counter if Convex was stable long enough
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
        console.error('[dev] Convex failed to recover:', err.message);
        restarting = false;
        void shutdown();
        return;
      }

      restarting = false;
    }

    function startHealthCheck() {
      healthCheckTimer = setInterval(async () => {
        if (shuttingDown || restarting) return;

        const alive = await tcpProbe(
          CONVEX_HOST,
          CONVEX_PORT,
          HEALTH_CHECK_TIMEOUT_MS,
        );

        if (alive) {
          consecutiveFailures = 0;
          return;
        }

        // Process already exited — the exit handler will deal with shutdown
        if (convexProcess?.killed || convexProcess?.exitCode != null) return;

        consecutiveFailures++;
        console.warn(
          `[dev] Convex health check failed (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`,
        );

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          consecutiveFailures = 0;
          void restartConvex();
        }
      }, HEALTH_CHECK_INTERVAL_MS);

      // Don't let the timer keep the process alive during shutdown
      healthCheckTimer.unref();
    }

    // Step 1: Start Convex in background
    console.log('[dev] ⏳ Starting Convex backend...');
    spawnConvex();

    // Step 2: Wait for Convex to be ready
    await waitForConvex();

    // Step 3: Sync environment variables
    console.log('[dev] 🔄 Syncing environment variables...');
    try {
      await runCommand('bun', ['scripts/sync-convex-env-from-dotenv.mjs']);
      console.log('[dev] ✅ Environment variables synced successfully');
    } catch (err) {
      console.warn('[dev] ⚠️  Env sync had errors:', err.message);
      // Continue anyway - this is not critical
    }

    // Step 4: Run code generation
    console.log('[dev] 🔄 Running code generation...');
    await runCommand('bunx', ['convex', 'codegen']);
    console.log('[dev] ✅ Code generation completed');

    // Step 5: Set CONVEX_URL for Vite proxy configuration
    const convexUrl =
      process.env.NEXT_PUBLIC_CONVEX_URL ||
      `http://${CONVEX_HOST}:${CONVEX_PORT}`;
    process.env.CONVEX_URL = convexUrl;
    console.log(`[dev] ✅ Set CONVEX_URL=${convexUrl} for Vite proxy`);

    // Step 6: Start TanStack Start
    const port = process.env.PORT || '3000';
    const siteUrl = process.env.SITE_URL || `http://localhost:${port}`;

    console.log('[dev] 🚀 Starting TanStack Start dev server...');
    console.log(`[dev] 🌐 Your app will be available at ${siteUrl}`);
    console.log(
      `[dev] 🌐 Also accessible via your internal IP address on port ${port}`,
    );
    console.log('');

    viteProcess = spawn(
      'bun',
      ['--bun', 'vite', 'dev', '--port', port, '--host', '0.0.0.0'],
      {
        stdio: 'inherit',
        cwd: platformRoot,
        env: process.env,
      },
    );

    // Handle shutdown
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;

      if (healthCheckTimer) clearInterval(healthCheckTimer);

      console.log('\n[dev] 👋 Shutting down...');

      await Promise.all([
        killProcessTree(convexProcess, 'SIGTERM'),
        killProcessTree(viteProcess, 'SIGTERM'),
      ]);

      // Wait a bit for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, 1000));

      console.log('[dev] ✅ All processes stopped');
      process.exit(0);
    };

    // Handle Ctrl+C and other termination signals
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Vite exit shuts everything down
    viteProcess.on('exit', (code) => {
      if (shuttingDown) return;
      console.log(`[dev] TanStack Start exited with code ${code}`);
      void shutdown();
    });

    // Step 7: Start health check for Convex auto-recovery
    startHealthCheck();
    console.log(
      `[dev] 🏥 Convex health check active (every ${HEALTH_CHECK_INTERVAL_MS / 1000}s)`,
    );

    // Keep the script running
    await new Promise(() => {});
  } catch (err) {
    console.error('[dev] ❌ Development environment failed:', err.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[dev] ❌ Orchestrator error:', err);
  process.exit(1);
});
