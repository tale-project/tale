#!/usr/bin/env node
/*
	Sync ALL environment variables from .env/.env.local into the LOCAL Convex deployment
	so Convex functions can read them at runtime (e.g., requireEnv("SITE_URL")).

	🔧 This script uses --local flag to sync with local Convex development backend.

	How it works:
	- Reads .env and .env.local from both repository root AND services/platform
	- Priority (highest to lowest): services/platform/.env.local > services/platform/.env > repo root/.env.local > repo root/.env
	- Syncs ALL environment variables to Convex using `npx convex env set --local`
	- Optimized: Checks existing values first and skips variables that are already set with the same value

	Notes:
	- Convex does NOT read your Next.js process env/.env files directly; you must use
	  `convex env set` to make variables available inside Convex functions.
	- Keep secrets only in .env/.env.local files, never commit them.
	- This script targets LOCAL development backend only.
	*/

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const platformRoot = join(__dirname, '..');
// Repository root is two levels up from services/platform
const repoRoot = join(__dirname, '..', '..', '..');

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

function findEnv() {
  // Read .env and .env.local from both repository root and services/platform
  // Priority (highest to lowest): services/platform/.env.local > services/platform/.env > repo root/.env.local > repo root/.env
  const repoEnvPath = join(repoRoot, '.env');
  const repoEnvLocalPath = join(repoRoot, '.env.local');
  const platformEnvPath = join(platformRoot, '.env');
  const platformEnvLocalPath = join(platformRoot, '.env.local');

  const repoBaseEnv = parseDotEnv(repoEnvPath);
  const repoLocalEnv = parseDotEnv(repoEnvLocalPath);
  const platformBaseEnv = parseDotEnv(platformEnvPath);
  const platformLocalEnv = parseDotEnv(platformEnvLocalPath);

  // Merge with priority: services/platform/.env.local > services/platform/.env > repo root/.env.local > repo root/.env
  return {
    ...repoBaseEnv,
    ...repoLocalEnv,
    ...platformBaseEnv,
    ...platformLocalEnv,
  };
}

function runConvexEnvList() {
  // Get all current environment variables from Convex
  const proc = spawnSync('npx', ['--yes', 'convex', 'env', 'list'], {
    stdio: ['inherit', 'pipe', 'inherit'], // Capture stdout only
    cwd: platformRoot,
    env: {
      ...process.env,
      CONVEX_AGENT_MODE: 'anonymous', // Skip login prompt and force local development
    },
  });
  if (proc.error) {
    return { ok: false, reason: proc.error.message, envVars: {} };
  }
  if (typeof proc.status === 'number' && proc.status !== 0) {
    return { ok: false, reason: `exit ${proc.status}`, envVars: {} };
  }

  // Parse the output to extract environment variables
  const output = proc.stdout?.toString() || '';
  const envVars = {};

  // Parse lines like "KEY=value" from the convex env list output
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip header lines or decorative lines
    if (
      trimmed.includes('Environment Variables') ||
      trimmed.includes('---') ||
      trimmed.includes('Name') ||
      trimmed.startsWith('│') ||
      trimmed.startsWith('┌') ||
      trimmed.startsWith('└')
    ) {
      continue;
    }

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();

    // Remove quotes if present
    let cleanValue = value;
    if (
      (cleanValue.startsWith('"') && cleanValue.endsWith('"')) ||
      (cleanValue.startsWith("'") && cleanValue.endsWith("'"))
    ) {
      cleanValue = cleanValue.slice(1, -1);
    }

    envVars[key] = cleanValue;
  }

  return { ok: true, envVars };
}

function runConvexEnvGet(key) {
  // Get a specific environment variable from Convex (more reliable than parsing list output)
  const proc = spawnSync('npx', ['--yes', 'convex', 'env', 'get', key], {
    stdio: ['inherit', 'pipe', 'pipe'], // Capture stdout and stderr
    cwd: platformRoot,
    env: {
      ...process.env,
      CONVEX_AGENT_MODE: 'anonymous', // Skip login prompt and force local development
    },
  });

  // Check for error or non-zero exit (env var doesn't exist)
  if (proc.error) {
    return { ok: false, exists: false, reason: proc.error.message };
  }
  if (typeof proc.status === 'number' && proc.status !== 0) {
    // Non-zero exit usually means the env var doesn't exist
    return { ok: true, exists: false };
  }

  // Parse the output - convex env get outputs just the value
  const output = proc.stdout?.toString().trim() || '';
  return { ok: true, exists: true, value: output };
}

function runConvexEnvSet(key, value) {
  if (typeof value !== 'string' || value.length === 0)
    return { ok: false, reason: 'empty' };
  // Use spawn to avoid shell quoting pitfalls - use anonymous mode for local development
  const proc = spawnSync('npx', ['--yes', 'convex', 'env', 'set', key, value], {
    stdio: 'inherit',
    cwd: platformRoot,
    env: {
      ...process.env,
      CONVEX_AGENT_MODE: 'anonymous', // Skip login prompt and force local development
    },
  });
  if (proc.error) {
    return { ok: false, reason: proc.error.message };
  }
  if (typeof proc.status === 'number' && proc.status !== 0) {
    return { ok: false, reason: `exit ${proc.status}` };
  }
  return { ok: true };
}

function runConvexEnvRemove(key) {
  // Use spawn to avoid shell quoting pitfalls - use anonymous mode for local development
  const proc = spawnSync('npx', ['--yes', 'convex', 'env', 'remove', key], {
    stdio: 'inherit',
    cwd: platformRoot,
    env: {
      ...process.env,
      CONVEX_AGENT_MODE: 'anonymous', // Skip login prompt and force local development
    },
  });
  if (proc.error) {
    return { ok: false, reason: proc.error.message };
  }
  if (typeof proc.status === 'number' && proc.status !== 0) {
    return { ok: false, reason: `exit ${proc.status}` };
  }
  return { ok: true };
}

async function main() {
  const envMap = findEnv();

	  // If SITE_URL is absent, default to http://localhost:3000
	  if (!envMap.SITE_URL) {
	    const inferred = 'http://localhost:3000';
	    console.log(
	      `[sync-convex-env] SITE_URL not set in .env; using default: ${inferred}`,
	    );
	    envMap.SITE_URL = inferred;
	  }

	  // Get all keys from the environment map
	  const keys = Object.keys(envMap);

	  if (keys.length === 0) {
	    console.log(
	      '[sync-convex-env] No environment variables found in .env/.env.local',
	    );
	    return;
	  }

	  console.log(
	    `[sync-convex-env] Found ${keys.length} environment variables to sync`,
	  );

  // Step 1: Get all existing environment variables from Convex
  console.log('[sync-convex-env] Fetching existing environment variables...');
  const existingEnvRes = runConvexEnvList();
  const existingEnvVars = existingEnvRes.ok ? existingEnvRes.envVars : {};
  const existingKeys = new Set(Object.keys(existingEnvVars));

  if (!existingEnvRes.ok) {
    console.warn(
      `[sync-convex-env] Warning: Could not fetch existing env vars: ${existingEnvRes.reason}`,
    );
    console.warn('[sync-convex-env] Will proceed to set all variables...');
  } else {
    console.log(
      `[sync-convex-env] Found ${existingKeys.size} existing environment variables (from list)`,
    );
  }

  // Step 2: Smart sync - compare and only update what's different
  let hadError = false;
  let skippedCount = 0;
  let updatedCount = 0;
  let removedCount = 0;
  let isFirstUpdate = true;

  // 2a: Set/update variables from .env
  console.log('[sync-convex-env] Syncing environment variables...');
  for (const key of keys) {
    const newValue = envMap[key];
    if (!newValue) {
      console.warn(`[sync-convex-env] Skipping ${key}: empty value`);
      continue;
    }

    const listValue = existingEnvVars[key];

    // Quick check using list output first
    if (existingKeys.has(key) && listValue === newValue) {
      console.log(`  ⏭️  ${key} (unchanged, skipping)`);
      skippedCount++;
      continue;
    }

    // If list says it's different or missing, double-check with `convex env get`
    // (convex env list output can be unreliable)
    const getResult = runConvexEnvGet(key);
    if (getResult.ok && getResult.exists && getResult.value === newValue) {
      console.log(`  ⏭️  ${key} (unchanged after verify, skipping)`);
      skippedCount++;
      continue;
    }

    // Value is new or different, update it
    const action = getResult.exists ? 'updating' : 'adding';
    console.log(`  ✏️  ${key} = ******** (${action})`);
    const res = runConvexEnvSet(key, newValue);
    if (!res.ok) {
      hadError = true;
      console.error(`[sync-convex-env] Failed to set ${key}: ${res.reason}`);
    } else {
      updatedCount++;
    }

    // Wait ~15s after first env update to allow Convex to settle (helps first deploy)
    if (isFirstUpdate && updatedCount === 1) {
      isFirstUpdate = false;
      console.log(
        '  ⏳ Waiting 15 seconds for Convex to settle after first environment variable...',
      );

      // Show countdown every second
      for (let i = 15; i > 0; i--) {
        console.log(`  ⏳ ${i} seconds remaining...`);
        await wait(1000);
      }

      console.log('  ✓ Wait completed, continuing...');
    }
  }

  // 2b: Remove variables that exist in Convex but not in .env (to keep in sync)
  const keysToRemove = [...existingKeys].filter((key) => !envMap[key]);
  if (keysToRemove.length > 0) {
    console.log(
      `[sync-convex-env] Removing ${keysToRemove.length} stale environment variables...`,
    );
    for (const key of keysToRemove) {
      console.log(`  🗑️  ${key} (removing, not in .env)`);
      const res = runConvexEnvRemove(key);
      if (!res.ok) {
        hadError = true;
        console.error(
          `[sync-convex-env] Failed to remove ${key}: ${res.reason}`,
        );
      } else {
        removedCount++;
      }
    }
  }

  // Summary
  console.log('\n[sync-convex-env] Summary:');
  console.log(`  - Skipped (unchanged): ${skippedCount}`);
  console.log(`  - Updated/Added: ${updatedCount}`);
  console.log(`  - Removed (stale): ${removedCount}`);

  if (hadError) {
    console.warn(
      '\n[sync-convex-env] Completed with some errors. You can re-run:',
    );
    console.warn('  node scripts/sync-convex-env-from-dotenv.mjs');
    process.exitCode = 1;
  } else {
    console.log('[sync-convex-env] ✓ Sync completed successfully.');
  }
}

main().catch((err) => {
  console.error('[sync-convex-env] Unexpected error:', err);
  process.exit(1);
});
