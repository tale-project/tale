/**
 * DB migration over `appProjectBindings`: copy the owning app's org-level
 * `appInstallations.config` onto each binding's `config` so a `scope: 'project'`
 * app holds its config per-project. Both `up` and `down` are idempotent.
 */

import type { Id } from '../../../../_generated/dataModel';
import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function installConfig(
  ctx: MutationCtx,
  organizationId: string,
  appSlug: string,
): Promise<Record<string, unknown> | undefined> {
  const install = await ctx.db
    .query('appInstallations')
    .withIndex('by_org_slug', (q) =>
      q.eq('organizationId', organizationId).eq('appSlug', appSlug),
    )
    .first();
  return record(install?.config);
}

export const migration: DbMigration = {
  meta,
  table: 'appProjectBindings',

  async up(ctx: MutationCtx, doc: MigrationDoc) {
    // Already has its own per-project config — leave it (idempotent).
    if (doc.config !== undefined) return;
    const organizationId = str(doc.organizationId);
    const appSlug = str(doc.appSlug);
    if (!organizationId || !appSlug) return;
    const cfg = await installConfig(ctx, organizationId, appSlug);
    if (!cfg || Object.keys(cfg).length === 0) return;
    await ctx.db.patch(doc._id as Id<'appProjectBindings'>, { config: cfg });
  },

  async down(ctx: MutationCtx, doc: MigrationDoc) {
    const current = record(doc.config);
    if (!current) return;
    const organizationId = str(doc.organizationId);
    const appSlug = str(doc.appSlug);
    if (!organizationId || !appSlug) return;
    const cfg = await installConfig(ctx, organizationId, appSlug);
    // Clear only the copy this migration made; preserve a post-migration edit.
    if (cfg && JSON.stringify(cfg) === JSON.stringify(current)) {
      await ctx.db.patch(doc._id as Id<'appProjectBindings'>, {
        config: undefined,
      });
    }
  },
};
