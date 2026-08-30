/**
 * `tale migrate` orchestration.
 *
 * SCHEMA migrations need no door: the backend applies them under an advisory
 * lock at boot, so a deployed image is always at its own schema. What stays
 * operator-triggered is the idempotent per-org seeding (config scaffold,
 * default automation packs, starter content), which the control door queues
 * as one `org.scaffold` job per org — a slow or failing org retries on its
 * own without blocking the rest, and the command returns as soon as they are
 * queued.
 *
 * Safe to re-run: already-provisioned content is skipped.
 */

import * as logger from '../../utils/logger';
import {
  backendApiContainer,
  controlCall,
  isBackendTierRunning,
} from '../docker/control-call';

interface RunMigrationsOptions {
  dryRun: boolean;
}

export async function runMigrations(
  options: RunMigrationsOptions,
): Promise<void> {
  const container = backendApiContainer();

  if (options.dryRun) {
    logger.blank();
    logger.info(
      `[DRY-RUN] Would re-provision every organization via POST /api/control/provision in ${container} ` +
        '(schema migrations run at backend boot).',
    );
    return;
  }

  if (!(await isBackendTierRunning())) {
    throw new Error(
      `tale migrate needs the backend tier: no ${container} container is running. ` +
        'Start the deployment (`tale start`), then re-run.',
    );
  }

  logger.blank();
  logger.step('Re-provisioning built-in defaults for every organization...');
  const res = await controlCall('POST', '/api/control/provision', {
    container,
  });
  if (!res.success) {
    throw new Error(
      `tale migrate failed: the control door refused in ${container}. ` +
        `${res.stderr.trim().slice(0, 200)} — the step is idempotent, so ` +
        're-run after addressing the failure.',
    );
  }

  let organizations: number | null = null;
  try {
    const parsed: unknown = JSON.parse(res.stdout);
    if (typeof parsed === 'object' && parsed !== null) {
      const value = (parsed as Record<string, unknown>).organizations;
      if (typeof value === 'number') organizations = value;
    }
  } catch (err) {
    logger.debug(`provision response parse failed: ${String(err)}`);
  }
  logger.success(
    organizations === null
      ? 'Provisioning queued.'
      : `Provisioning queued for ${organizations} organization(s).`,
  );
}
