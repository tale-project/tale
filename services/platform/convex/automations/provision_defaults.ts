'use node';

/**
 * Default-automation provisioner: makes `autoInstall: true` automations come
 * out of the box for every organization. An automation dir seeded into the org
 * config tree is inert until installed — this action walks the org's
 * `automations/` catalog and, for every org-scoped manifest that declares
 * `autoInstall` and has not been provisioned before (tracked per slug in
 * `wfDefaultProvisions` — the inline workflow's slug IS the automation slug):
 *
 *   1. runs the ONE install pipeline every install path shares
 *      (`prepareInstallAs` + `ensureOrgResources`: files, inline workflow,
 *      agents, install row, schedules, org-scope event triggers),
 *   2. records the provision so the org is never re-provisioned behind its
 *      back — an org's later uninstall or trigger edit always wins.
 *
 * Invoked from the org-creation hook (after the scaffold copies the catalog),
 * from the deploy-time `provisionAll` sweep (new packs reach existing orgs),
 * and after a builtin-catalog resync. Self-retries once while the scaffold is
 * still copying. Replaces the retired standalone-workflow provisioner
 * (`workflows/provision_defaults.ts`) — a workflow only exists inside an
 * automation now.
 */

import { stat } from 'node:fs/promises';

import { v } from 'convex/values';

import { automationScope } from '../../lib/shared/schemas/automations';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { serializeJson, sha256 } from '../lib/file_io';
import { listAutomationSlugs, resolveAutomationsDir } from './file_utils';
import { ensureOrgResources, prepareInstallAs } from './install_actions';
import { readBundleManifest } from './install_fs';

const RETRY_DELAY_MS = 30_000;
const MAX_ATTEMPTS = 3;

export const syncDefaultAutomationInstallations = internalAction({
  args: {
    organizationId: v.string(),
    orgSlug: v.string(),
    attempt: v.optional(v.number()),
  },
  returns: v.object({
    provisioned: v.number(),
    skipped: v.number(),
    failed: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ provisioned: number; skipped: number; failed: number }> => {
    const attempt = args.attempt ?? 1;

    const automationsDir = resolveAutomationsDir(args.orgSlug);
    let slugs: string[];
    try {
      // `stat` first: the walk below reports a MISSING tree as "no automations",
      // but here that means the scaffold has not copied it yet — which must
      // retry, not conclude there is nothing to provision.
      await stat(automationsDir);
      slugs = await listAutomationSlugs(automationsDir, 'AutomationProvision');
    } catch {
      // Scaffold may still be copying the catalog — retry a bounded number
      // of times, then give up quietly (the deploy-time sweep re-runs).
      if (attempt < MAX_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          RETRY_DELAY_MS,
          internal.automations.provision_defaults
            .syncDefaultAutomationInstallations,
          { ...args, attempt: attempt + 1 },
        );
      } else {
        console.warn(
          '[AutomationProvision] automations dir missing after retries; giving up',
          { orgSlug: args.orgSlug },
        );
      }
      return { provisioned: 0, skipped: 0, failed: 0 };
    }

    let provisioned = 0;
    let skipped = 0;
    let failed = 0;

    for (const automationSlug of slugs) {
      try {
        // A bundle aggregates other automations and installs nothing itself,
        // so it can never be auto-installed — skip it before reading the
        // (absent) automation.json.
        if (await readBundleManifest(args.orgSlug, automationSlug)) continue;
        const install = await prepareInstallAs(
          args.orgSlug,
          automationSlug,
          'system',
        );
        const { manifest } = install;
        if (manifest.autoInstall !== true) continue;
        if (automationScope(manifest) !== 'org') {
          // A project automation needs a human-chosen project binding; there is
          // no sane default to install against, so autoInstall cannot apply.
          console.warn(
            `[AutomationProvision] ignoring autoInstall on project-scoped automation "${automationSlug}"`,
          );
          continue;
        }

        const existing = await ctx.runQuery(
          internal.workflows.provision_defaults_mutations.getProvision,
          { organizationId: args.organizationId, workflowSlug: automationSlug },
        );
        if (existing) {
          // Provisioned once already — never re-provision behind the org's
          // back (an uninstall or a deactivated trigger sticks).
          skipped += 1;
          continue;
        }

        await ensureOrgResources(
          ctx,
          args.organizationId,
          automationSlug,
          install,
        );

        await ctx.runMutation(
          internal.workflows.provision_defaults_mutations.recordProvision,
          {
            organizationId: args.organizationId,
            workflowSlug: automationSlug,
            contentHash: sha256(serializeJson(manifest)),
          },
        );
        provisioned += 1;
        console.log('[AutomationProvision] provisioned', {
          org: args.organizationId,
          automationSlug,
        });
      } catch (error) {
        failed += 1;
        console.error('[AutomationProvision] failed for automation', {
          automationSlug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { provisioned, skipped, failed };
  },
});
