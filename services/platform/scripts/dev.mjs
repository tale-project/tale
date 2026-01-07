#!/usr/bin/env node
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
  6) Start Next.js dev server with loaded environment variables
  7) Handle Ctrl+C (SIGINT/SIGTERM) to cleanly shut down both processes

  This ensures local development without cloud dependencies and avoids timing issues.

  Uses Node.js native spawn + wait-on library for proper signal handling (Ctrl+C works correctly).
*/

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import process from 'node:process';
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
  // Next.js/server basics
  // Force development mode for local dev
  process.env.NODE_ENV = 'development';
  if (!process.env.PORT) process.env.PORT = '3000';
  if (!process.env.HOSTNAME) process.env.HOSTNAME = '0.0.0.0';

  // Domain configuration - ensure protocol and add port for localhost
  const port = process.env.PORT || '3000';
  let baseUrl = process.env.SITE_URL || 'http://localhost';

  // Ensure protocol
  if (!/^https?:\/\//i.test(baseUrl)) {
    baseUrl = `http://${baseUrl}`;
  }

  // Add port for localhost if not already present
  if (baseUrl === 'http://localhost') {
    baseUrl = `${baseUrl}:${port}`;
  }

  // Database: POSTGRES_URL left as-is if provided

  // Convex instance configuration
  if (!process.env.INSTANCE_NAME) process.env.INSTANCE_NAME = 'tale_platform';
  // INSTANCE_SECRET handled by ensureInstanceSecret()

  // AI providers: OPENAI_API_KEY left as-is if provided

  // SITE_URL is the canonical base URL - all other URLs are derived from it in code
  // For localhost, baseUrl already includes the port, so use it directly
  if (!process.env.SITE_URL) process.env.SITE_URL = baseUrl;
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

  try {
    // Step 0: Load environment variables from repository root
    loadEnvFiles();
    console.log('');

    // Step 0.5: Normalize and inject derived env vars (mirror env.sh)
    envNormalizeCommon();
    ensureInstanceSecret();
    // For local anonymous Convex dev, ensure CONVEX_DEPLOYMENT is not set.
    // If it is set (e.g. from the shell or other tooling), clear it so Convex
    // runs without requiring a cloud login.
    if (process.env.CONVEX_DEPLOYMENT) {
      console.log(
        '[dev] ℹ️  Clearing CONVEX_DEPLOYMENT for local anonymous Convex dev',
      );
      delete process.env.CONVEX_DEPLOYMENT;
    }
    console.log('[dev] ✅ Environment normalized (env.sh parity)');

    // Step 1: Start Convex in background
    console.log('[dev] ⏳ Starting Convex backend...');
    const convexProcess = spawn('npx', ['--yes', 'convex', 'dev'], {
      stdio: 'inherit',
      cwd: platformRoot,
      env: {
        ...process.env,
        CONVEX_AGENT_MODE: 'anonymous',
      },
    });

    // Step 2: Wait for Convex to be ready
    console.log('[dev] ⏳ Waiting for Convex backend on port 3210...');
    await runCommand('npx', [
      '--yes',
      'wait-on',
      'tcp:127.0.0.1:3210',
      '--timeout',
      '180000', // 3 minutes
      '--interval',
      '250',
    ]);
    console.log('[dev] ✅ Convex backend is ready!');

    // Step 3: Sync environment variables
    console.log('[dev] 🔄 Syncing environment variables...');
    try {
      await runCommand('node', ['scripts/sync-convex-env-from-dotenv.mjs']);
      console.log('[dev] ✅ Environment variables synced successfully');
    } catch (err) {
      console.warn('[dev] ⚠️  Env sync had errors:', err.message);
      // Continue anyway - this is not critical
    }

    // Step 4: Run code generation
    console.log('[dev] 🔄 Running code generation...');
    await runCommand('npx', ['--yes', 'convex', 'codegen']);
    console.log('[dev] ✅ Code generation completed');

    // Step 5: Start Next.js
    const port = process.env.PORT || '3000';
    const siteUrl = process.env.SITE_URL || `http://localhost:${port}`;

    console.log('[dev] 🚀 Starting Next.js dev server...');
    console.log(`[dev] 🌐 Your app will be available at ${siteUrl}`);
    console.log(
      `[dev] 🌐 Also accessible via your internal IP address on port ${port}`,
    );
    console.log('');

    const nextProcess = spawn(
      'npx',
      ['--yes', 'next', 'dev', '--port', port, '--hostname', '0.0.0.0'],
      {
        stdio: 'inherit',
        cwd: platformRoot,
        env: process.env,
      },
    );

    // Handle shutdown
    const shutdown = async () => {
      console.log('\n[dev] 👋 Shutting down...');

      // Kill both process trees (including all child processes)
      const killPromises = [];

      if (convexProcess && !convexProcess.killed && convexProcess.pid) {
        killPromises.push(
          new Promise((resolve) => {
            kill(convexProcess.pid, 'SIGTERM', (err) => {
              if (err) {
                console.warn(
                  '[dev] ⚠️  Error killing Convex process tree:',
                  err.message,
                );
              }
              resolve();
            });
          }),
        );
      }

      if (nextProcess && !nextProcess.killed && nextProcess.pid) {
        killPromises.push(
          new Promise((resolve) => {
            kill(nextProcess.pid, 'SIGTERM', (err) => {
              if (err) {
                console.warn(
                  '[dev] ⚠️  Error killing Next.js process tree:',
                  err.message,
                );
              }
              resolve();
            });
          }),
        );
      }

      // Wait for all processes to be killed
      await Promise.all(killPromises);

      // Wait a bit for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, 1000));

      console.log('[dev] ✅ All processes stopped');
      process.exit(0);
    };

    // Handle Ctrl+C and other termination signals
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // If either process exits, shut down everything
    convexProcess.on('exit', (code) => {
      console.log(`[dev] Convex exited with code ${code}`);
      shutdown();
    });

    nextProcess.on('exit', (code) => {
      console.log(`[dev] Next.js exited with code ${code}`);
      shutdown();
    });

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
