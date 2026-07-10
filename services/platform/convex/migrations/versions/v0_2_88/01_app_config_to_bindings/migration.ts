/**
 * 0.2.88 / 01 — copy an app's ORG-LEVEL config (`appInstallations.config`) onto
 * each of its project bindings (`appProjectBindings.config`).
 *
 * Per-project config is now authoritative for a `scope: 'project'` app, so an
 * existing single-config install is folded down to per-binding config (the org
 * row keeps its copy as the legacy fallback). Idempotent — skips a binding that
 * already has config. `down` clears only the bindings whose config still equals
 * the org copy, leaving any post-migration per-project edit intact.
 *
 * The runner paginates `appProjectBindings`. `config` was dropped from both
 * tables' live schema by the 0.2.91 app-config-to-schedule-variables cutover —
 * this migration predates that and still needs to read/write it, so every
 * access below is untyped (`as any`), matching the framework's convention for
 * a field absent from the current schema (see e.g.
 * `v0_2_14/01_usage_ledger_drop_cost_fields`).
 */

import type { MutationCtx } from '../../../../_generated/server';
import { defineDbMigration } from '../../../framework/define';

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
  const install = await (ctx.db as any)
    .query('appInstallations')
    .withIndex('by_org_slug', (q: any) =>
      q.eq('organizationId', organizationId).eq('appSlug', appSlug),
    )
    .first();
  return record(install?.config);
}

export const migration = defineDbMigration({
  title: 'Copy org-level app config onto each project binding',
  description:
    "Copies each installed app's appInstallations.config onto its " +
    'appProjectBindings rows so a scope:project app holds config per-project. ' +
    'Idempotent — skips a binding that already has config. down clears only the ' +
    'bindings whose config still equals the org copy.',
  destructive: false,
  snapshot: 'none',
  subjects: { tables: ['appProjectBindings', 'appInstallations'] },
  table: 'appProjectBindings',

  async up(ctx, doc) {
    // Already has its own per-project config — leave it (idempotent).
    if (doc.config !== undefined) return;
    const organizationId = str(doc.organizationId);
    const appSlug = str(doc.appSlug);
    if (!organizationId || !appSlug) return;
    const cfg = await installConfig(ctx, organizationId, appSlug);
    if (!cfg || Object.keys(cfg).length === 0) return;
    // oxlint-disable-next-line typescript/no-explicit-any -- config absent from the current schema
    await (ctx.db as any).patch(doc._id, { config: cfg });
  },

  async down(ctx, doc) {
    const current = record(doc.config);
    if (!current) return;
    const organizationId = str(doc.organizationId);
    const appSlug = str(doc.appSlug);
    if (!organizationId || !appSlug) return;
    const cfg = await installConfig(ctx, organizationId, appSlug);
    // Clear only the copy this migration made; preserve a post-migration edit.
    if (cfg && JSON.stringify(cfg) === JSON.stringify(current)) {
      // oxlint-disable-next-line typescript/no-explicit-any -- config absent from the current schema
      await (ctx.db as any).patch(doc._id, {
        config: undefined,
      });
    }
  },
});
