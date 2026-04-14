import * as logger from '../../../utils/logger';
import { docker } from '../../docker/docker';
import type { Migration, MigrationContext } from '../types';

/**
 * Convex was previously emitted in the color compose file (blue/green project)
 * even though it is a singleton. This migration detects the existing convex
 * container under a color project and removes it so the stateful compose can
 * recreate it under the main project. The convex-data volume is external and
 * is not affected.
 */

async function getContainerProjectLabel(
  containerName: string,
): Promise<string | null> {
  const result = await docker(
    'inspect',
    '--format',
    '{{index .Config.Labels "com.docker.compose.project"}}',
    containerName,
  );
  if (!result.success) return null;
  const label = result.stdout.trim();
  return label || null;
}

export const adoptConvexStatefulMigration: Migration = {
  id: 'adopt-convex-stateful',
  introducedIn: '0.3.1',
  description: (ctx: MigrationContext) =>
    `Move ${ctx.projectId}-convex container from blue/green project scope to stateful project scope (${ctx.projectId}).`,

  async detect(ctx: MigrationContext): Promise<boolean> {
    const label = await getContainerProjectLabel(`${ctx.projectId}-convex`);
    if (!label) return false; // container doesn't exist — fresh install
    return label !== ctx.projectId; // needs migration if owned by a color project
  },

  async requiredStops(ctx: MigrationContext): Promise<string[]> {
    const label = await getContainerProjectLabel(`${ctx.projectId}-convex`);
    if (!label || label === ctx.projectId) return [];
    return [`${ctx.projectId}-convex`];
  },

  async apply(ctx, { dryRun }) {
    if (dryRun) return 'noop';

    const containerName = `${ctx.projectId}-convex`;
    const label = await getContainerProjectLabel(containerName);
    if (!label || label === ctx.projectId) return 'noop';

    logger.info(
      `  Removing ${containerName} (owned by project "${label}") so it can be recreated under "${ctx.projectId}"`,
    );
    const result = await docker('rm', '-f', containerName);
    if (!result.success) {
      throw new Error(
        `Failed to remove ${containerName}: ${result.stderr.trim()}`,
      );
    }

    logger.info(
      '  The convex-data volume is preserved. The container will be recreated by the next deploy.',
    );
    return 'applied';
  },
};
