/**
 * `tale migrate config-layout` orchestration. Pipes the migrate-config-layout
 * bash script into the currently-running convex container via stdin so the
 * operator can run migrate FIRST (before redeploying with the new image).
 *
 * Uses cp (not mv) so old paths remain readable until the operator runs
 * `tale migrate config-layout --cleanup-old` after verifying the new
 * deployment is healthy. This is the rollback-insurance step.
 *
 * Runbook (2-step + optional cleanup):
 *   1. tale migrate config-layout
 *      (copies providers/*.secrets.json to new org-first paths;
 *      old paths remain so the currently-running old code still works)
 *   2. tale deploy --override-all -y
 *      (recreates convex with new code + seeds non-default orgs from builtin)
 *   3. (optional, after verifying health) tale migrate config-layout --cleanup-old
 *      (sha-verifies new == old, then unlinks the olds)
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getProjectId } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { exec } from '../docker/exec';
import { isContainerRunning } from '../docker/is-container-running';

export interface MigrateConfigLayoutOptions {
  dryRun: boolean;
  cleanupOld: boolean;
}

/**
 * Read the migrate script next to this module. The .sh file is the source
 * of truth (also runnable in the shell-script integration harness), and
 * Bun's source-file colocation makes runtime loading work in both `bun
 * run`-from-source and the compiled binary (Bun bundles imported assets).
 */
async function loadScript(): Promise<string> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const scriptPath = join(
    moduleDir,
    '..',
    'migrate-config-layout',
    'script.sh',
  );
  return await readFile(scriptPath, 'utf-8');
}

export async function migrateConfigLayout(
  options: MigrateConfigLayoutOptions,
): Promise<void> {
  const { dryRun, cleanupOld } = options;

  const containerName = `${getProjectId()}-convex`;
  if (!(await isContainerRunning(containerName))) {
    throw new Error(
      `Convex container "${containerName}" is not running. ` +
        'Start the platform first (e.g. `tale deploy`) before running this migration.',
    );
  }

  const script = await loadScript();

  const scriptArgs: string[] = [];
  if (dryRun) scriptArgs.push('--dry-run');
  if (cleanupOld) scriptArgs.push('--cleanup-old');

  logger.blank();
  if (cleanupOld) {
    logger.step(
      dryRun
        ? '[DRY-RUN] Cleanup-old: would verify and remove old-path secrets'
        : 'Verifying + removing old-path secrets (sha-matched against new paths)...',
    );
  } else {
    logger.step(
      dryRun
        ? '[DRY-RUN] Migrate: would cp providers/*.secrets.json to new org-first paths'
        : 'Copying providers/*.secrets.json to new org-first paths (old paths preserved for rollback)...',
    );
  }

  // `docker exec -i ... bash -s -- <args>` runs the script piped via
  // stdin; the `--` separates script args from bash's own flags.
  const result = await exec(
    'docker',
    ['exec', '-i', containerName, 'bash', '-s', '--', ...scriptArgs],
    { stdin: script },
  );

  if (result.stdout) logger.info(result.stdout);
  if (!result.success) {
    if (result.stderr) logger.error(result.stderr.trim());
    throw new Error(
      `tale migrate config-layout${cleanupOld ? ' --cleanup-old' : ''} failed (exit code ${result.exitCode}).`,
    );
  }
  if (result.stderr) {
    // Warnings printed to stderr (e.g. SKIP messages) are not fatal but worth surfacing.
    logger.warn(result.stderr.trim());
  }
}
