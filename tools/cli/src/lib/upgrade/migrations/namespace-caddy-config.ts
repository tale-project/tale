import * as logger from '../../../utils/logger';
import type { Migration, MigrationContext } from '../types';
import {
  copyVolumeWithVerify,
  resolveMigrationImage,
  volumeExists,
  volumeHasData,
} from '../volume-helpers';

/**
 * Supplemental fix: `caddy-config` was accidentally omitted from PROD_VOLUMES
 * in the namespace-volumes migration, so `tale_caddy-config` was never copied
 * to `${projectId}_caddy-config` for existing production deployments.
 *
 * This migration uses the same idempotent end-state check: only copies if the
 * source has data and the destination is absent or empty.
 */

const LEGACY_PROJECT_NAME = 'tale';

export const namespaceCaddyConfigMigration: Migration = {
  id: 'namespace-caddy-config',
  introducedIn: '0.3.1',
  description: (ctx: MigrationContext) =>
    `Copy ${LEGACY_PROJECT_NAME}_caddy-config to ${ctx.projectId}_caddy-config (missed by namespace-volumes).`,

  async detect(ctx: MigrationContext): Promise<boolean> {
    const oldName = `${LEGACY_PROJECT_NAME}_caddy-config`;
    const newName = `${ctx.projectId}_caddy-config`;

    if (!(await volumeExists(oldName))) return false;

    // If destination already has data, nothing to do.
    const image = await resolveMigrationImage();
    if (
      (await volumeExists(newName)) &&
      (await volumeHasData(newName, image))
    ) {
      return false;
    }

    return volumeHasData(oldName, image);
  },

  async requiredStops(): Promise<string[]> {
    // Proxy is the only consumer of caddy-config and it lives in the
    // stateful compose under the namespaced project. The legacy compose
    // projects ('tale', etc.) were already torn down by namespace-volumes.
    return [];
  },

  async apply(ctx, { dryRun }) {
    if (dryRun) return 'noop';

    const oldName = `${LEGACY_PROJECT_NAME}_caddy-config`;
    const newName = `${ctx.projectId}_caddy-config`;

    const image = await resolveMigrationImage();

    // Re-check end-state (idempotent).
    if (
      (await volumeExists(newName)) &&
      (await volumeHasData(newName, image))
    ) {
      return 'noop';
    }
    if (!(await volumeExists(oldName))) return 'noop';
    if (!(await volumeHasData(oldName, image))) return 'noop';

    logger.info(`  ${oldName} → ${newName}`);
    await copyVolumeWithVerify(oldName, newName, image);

    logger.info('Old volume preserved. After verifying, reclaim disk with:');
    logger.info(`  docker volume rm ${oldName}`);
    return 'applied';
  },
};
