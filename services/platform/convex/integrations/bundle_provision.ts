'use node';

/**
 * Provision the agents + workflows an integration BUNDLES when its credential
 * is connected (`integrationJsonSchema.bundles`). Bundled agents install with
 * provenance `installedBy: 'integration:<slug>'` + `bundledBy: <slug>` (so the
 * disconnect cascade can find them); bundled workflows install + get their
 * triggers created and activated. Idempotent. Scheduled from
 * `credential_mutations.ts` when a credential goes active. Also re-enables any
 * rows a prior disconnect cascade-disabled (via `cascadeIntegration` enable).
 */

import { v } from 'convex/values';

import { workflowJsonSchema } from '../../lib/shared/schemas/workflows';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { readAgentBySlug } from '../agents/internal_actions';
import { listCatalogArea } from '../lib/config_store/catalog';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import {
  validateWorkflowSlug,
  workflowSlugFromRelativePath,
} from '../workflows/file_utils';
import { readIntegrationConfigFile } from './file_actions';

export const provisionIntegrationBundle = internalAction({
  args: { organizationId: v.string(), slug: v.string() },
  returns: v.object({ agents: v.number(), workflows: v.number() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ agents: number; workflows: number }> => {
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const cfg = await readIntegrationConfigFile(orgSlug, args.slug);
    if (!cfg.ok) return { agents: 0, workflows: 0 };
    const bundles = cfg.config.bundles;
    if (!bundles) return { agents: 0, workflows: 0 };

    // --- Bundled agents: install enabled, marked as integration-owned. ---
    let agents = 0;
    for (const agentSlug of bundles.agents ?? []) {
      const read = await readAgentBySlug(orgSlug, agentSlug);
      if (!read.ok) continue;
      await ctx.runMutation(internal.agents.installations.upsertInstallation, {
        organizationId: args.organizationId,
        agentSlug,
        installedBy: `integration:${args.slug}`,
        contentHash: read.hash,
        enabled: true,
        bundledBy: args.slug,
      });
      agents += 1;
    }

    // --- Bundled workflows: install + create & activate their triggers. ---
    let workflows = 0;
    const wanted = new Set(bundles.workflows ?? []);
    if (wanted.size > 0) {
      let files: Array<{ relativePath: string; content: string }> = [];
      try {
        files = await listCatalogArea('workflows', orgSlug, {
          recursive: true,
        });
      } catch {
        files = [];
      }
      for (const { relativePath, content } of files) {
        const workflowSlug = workflowSlugFromRelativePath(relativePath);
        if (!wanted.has(workflowSlug) || !validateWorkflowSlug(workflowSlug)) {
          continue;
        }
        const parsed = workflowJsonSchema.safeParse(JSON.parse(content));
        if (!parsed.success) continue;
        const wf = parsed.data;

        await ctx.runMutation(
          internal.workflows.installations.upsertInstallation,
          {
            organizationId: args.organizationId,
            workflowSlug,
            installedBy: `integration:${args.slug}`,
            contentHash: 'bundle',
          },
        );
        for (const event of wf.triggers?.events ?? []) {
          await ctx.runMutation(
            internal.workflows.provision_defaults_mutations
              .ensureEventSubscription,
            {
              organizationId: args.organizationId,
              workflowSlug,
              eventType: event.eventType,
              eventFilter: event.eventFilter,
              isActive: true,
            },
          );
        }
        for (const schedule of wf.triggers?.schedules ?? []) {
          await ctx.runMutation(
            internal.workflows.provision_defaults_mutations.ensureSchedule,
            {
              organizationId: args.organizationId,
              workflowSlug,
              cronExpression: schedule.cron,
              timezone: schedule.timezone,
              variables: schedule.variables,
              isActive: true,
            },
          );
        }
        workflows += 1;
      }
      // Make sure a reconnect re-activates triggers a prior disconnect paused.
      await ctx.runMutation(
        internal.workflows.provision_defaults_mutations
          .setTriggersActiveForSlugs,
        {
          organizationId: args.organizationId,
          workflowSlugs: [...wanted],
          isActive: true,
        },
      );
    }

    // Re-enable any agents a prior disconnect cascade-disabled.
    await ctx.runAction(internal.integrations.cascade.cascadeIntegration, {
      organizationId: args.organizationId,
      slug: args.slug,
      mode: 'enable',
    });

    console.log('[IntegrationBundle] provisioned', {
      org: args.organizationId,
      slug: args.slug,
      agents,
      workflows,
    });
    return { agents, workflows };
  },
});
