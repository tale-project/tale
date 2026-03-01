#!/usr/bin/env bun
/*
	Sync ALL environment variables from .env/.env.local into the LOCAL Convex deployment
	so Convex functions can read them at runtime (e.g., requireEnv("SITE_URL")).

	🔧 This script uses --local flag to sync with local Convex development backend.

	How it works:
	- Reads .env and .env.local from both repository root AND services/platform
	- Priority (highest to lowest): services/platform/.env.local > services/platform/.env > repo root/.env.local > repo root/.env
	- Syncs ALL environment variables to Convex using `bunx convex env set --local`
	- Optimized: Checks existing values first and skips variables that are already set with the same value

	Notes:
	- Convex does NOT read your TanStack Start process env/.env files directly; you must use
	  `convex env set` to make variables available inside Convex functions.
	- Keep secrets only in .env/.env.local files, never commit them.
	- This script targets LOCAL development backend only.
	*/

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const platformRoot = join(import.meta.dir, '..');
const repoRoot = join(import.meta.dir, '..', '..', '..');

interface ConvexEnvListResult {
  ok: boolean;
  reason?: string;
  envVars: Record<string, string>;
}

interface ConvexEnvGetResult {
  ok: boolean;
  exists: boolean;
  reason?: string;
  value?: string;
}

interface ConvexEnvMutationResult {
  ok: boolean;
  reason?: string;
}

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

function findEnv(): Record<string, string> {
  const repoEnvPath = join(repoRoot, '.env');
  const repoEnvLocalPath = join(repoRoot, '.env.local');
  const platformEnvPath = join(platformRoot, '.env');
  const platformEnvLocalPath = join(platformRoot, '.env.local');

  const repoBaseEnv = parseDotEnv(repoEnvPath);
  const repoLocalEnv = parseDotEnv(repoEnvLocalPath);
  const platformBaseEnv = parseDotEnv(platformEnvPath);
  const platformLocalEnv = parseDotEnv(platformEnvLocalPath);

  return {
    ...repoBaseEnv,
    ...repoLocalEnv,
    ...platformBaseEnv,
    ...platformLocalEnv,
  };
}

function runConvexEnvList(): ConvexEnvListResult {
  const proc = spawnSync('bunx', ['convex', 'env', 'list'], {
    stdio: ['inherit', 'pipe', 'inherit'],
    cwd: platformRoot,
    env: {
      ...process.env,
      CONVEX_AGENT_MODE: 'anonymous',
    },
  });
  if (proc.error) {
    return { ok: false, reason: proc.error.message, envVars: {} };
  }
  if (typeof proc.status === 'number' && proc.status !== 0) {
    return { ok: false, reason: `exit ${proc.status}`, envVars: {} };
  }

  const output = proc.stdout?.toString() || '';
  const envVars: Record<string, string> = {};

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

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

function runConvexEnvGet(key: string): ConvexEnvGetResult {
  const proc = spawnSync('bunx', ['convex', 'env', 'get', key], {
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: platformRoot,
    env: {
      ...process.env,
      CONVEX_AGENT_MODE: 'anonymous',
    },
  });

  if (proc.error) {
    return { ok: false, exists: false, reason: proc.error.message };
  }
  if (typeof proc.status === 'number' && proc.status !== 0) {
    return { ok: true, exists: false };
  }

  const output = proc.stdout?.toString().trim() || '';
  return { ok: true, exists: true, value: output };
}

function runConvexEnvSet(key: string, value: string): ConvexEnvMutationResult {
  if (typeof value !== 'string' || value.length === 0)
    return { ok: false, reason: 'empty' };
  const proc = spawnSync('bunx', ['convex', 'env', 'set', key, value], {
    stdio: 'inherit',
    cwd: platformRoot,
    env: {
      ...process.env,
      CONVEX_AGENT_MODE: 'anonymous',
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

function runConvexEnvRemove(key: string): ConvexEnvMutationResult {
  const proc = spawnSync('bunx', ['convex', 'env', 'remove', key], {
    stdio: 'inherit',
    cwd: platformRoot,
    env: {
      ...process.env,
      CONVEX_AGENT_MODE: 'anonymous',
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

  if (!envMap.SITE_URL) {
    const inferred = 'http://localhost:3000';
    console.log(
      `[sync-convex-env] SITE_URL not set in .env; using default: ${inferred}`,
    );
    envMap.SITE_URL = inferred;
  }

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

  let hadError = false;
  let skippedCount = 0;
  let updatedCount = 0;
  let removedCount = 0;
  let isFirstUpdate = true;

  console.log('[sync-convex-env] Syncing environment variables...');
  for (const key of keys) {
    const newValue = envMap[key];
    if (!newValue) {
      console.warn(`[sync-convex-env] Skipping ${key}: empty value`);
      continue;
    }

    const listValue = existingEnvVars[key];

    if (existingKeys.has(key) && listValue === newValue) {
      console.log(`  ⏭️  ${key} (unchanged, skipping)`);
      skippedCount++;
      continue;
    }

    const getResult = runConvexEnvGet(key);
    if (getResult.ok && getResult.exists && getResult.value === newValue) {
      console.log(`  ⏭️  ${key} (unchanged after verify, skipping)`);
      skippedCount++;
      continue;
    }

    const action = getResult.exists ? 'updating' : 'adding';
    console.log(`  ✏️  ${key} = ******** (${action})`);
    const res = runConvexEnvSet(key, newValue);
    if (!res.ok) {
      hadError = true;
      console.error(`[sync-convex-env] Failed to set ${key}: ${res.reason}`);
    } else {
      updatedCount++;
    }

    if (isFirstUpdate && updatedCount === 1) {
      isFirstUpdate = false;
      console.log(
        '  ⏳ Waiting 15 seconds for Convex to settle after first environment variable...',
      );

      for (let i = 15; i > 0; i--) {
        console.log(`  ⏳ ${i} seconds remaining...`);
        await wait(1000);
      }

      console.log('  ✓ Wait completed, continuing...');
    }
  }

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

  console.log('\n[sync-convex-env] Summary:');
  console.log(`  - Skipped (unchanged): ${skippedCount}`);
  console.log(`  - Updated/Added: ${updatedCount}`);
  console.log(`  - Removed (stale): ${removedCount}`);

  if (hadError) {
    console.warn(
      '\n[sync-convex-env] Completed with some errors. You can re-run:',
    );
    console.warn('  bun scripts/sync-convex-env-from-dotenv.ts');
    process.exitCode = 1;
  } else {
    console.log('[sync-convex-env] ✓ Sync completed successfully.');
  }
}

main().catch((err) => {
  console.error('[sync-convex-env] Unexpected error:', err);
  process.exit(1);
});
