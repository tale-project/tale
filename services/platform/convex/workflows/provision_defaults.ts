'use node';

/**
 * Default-workflow provisioner: makes `metadata.autoInstall` workflow files
 * actually RUN for an organization. A workflow file on disk is inert — it
 * needs a `wfInstallations` row (gates `processEvent`) plus trigger rows.
 * This action walks the org's workflows dir, and for every autoInstall file
 * not yet provisioned (tracked in `wfDefaultProvisions`):
 *
 *   1. upserts the `wfInstallations` row (installedBy 'system'),
 *   2. creates the file's declared triggers — CREATE-IF-ABSENT, so org
 *      edits/deactivations always win,
 *   3. records the provision so the org is never re-provisioned behind its
 *      back (uninstalls/opt-outs stick).
 *
 * Invoked from the org-creation hook (after the scaffold copies the catalog)
 * and from the ops migration for existing orgs. Self-retries once when the
 * workflows dir does not exist yet (scaffold still running).
 */

import { v } from 'convex/values';

import { workflowJsonSchema } from '../../lib/shared/schemas/workflows';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { listCatalogArea } from '../lib/config_store/catalog';
import { sha256 } from '../lib/file_io';
import {
  validateWorkflowSlug,
  workflowSlugFromRelativePath,
} from './file_utils';

const RETRY_DELAY_MS = 30_000;
const MAX_ATTEMPTS = 3;

export const syncDefaultWorkflowInstallations = internalAction({
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

    let files;
    try {
      files = await listCatalogArea('workflows', args.orgSlug, {
        recursive: true,
      });
    } catch {
      // Scaffold may still be copying the catalog — retry a bounded number
      // of times, then give up quietly (the ops migration can re-run).
      if (attempt < MAX_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          RETRY_DELAY_MS,
          internal.workflows.provision_defaults
            .syncDefaultWorkflowInstallations,
          { ...args, attempt: attempt + 1 },
        );
      } else {
        console.warn(
          '[TaskOpsProvision] workflows dir missing after retries; giving up',
          { orgSlug: args.orgSlug },
        );
      }
      return { provisioned: 0, skipped: 0, failed: 0 };
    }

    let provisioned = 0;
    let skipped = 0;
    let failed = 0;

    for (const { relativePath, content } of files) {
      const workflowSlug = workflowSlugFromRelativePath(relativePath);
      if (!workflowSlug || !validateWorkflowSlug(workflowSlug)) continue;

      try {
        const parsed = workflowJsonSchema.safeParse(JSON.parse(content));
        if (!parsed.success) {
          console.warn('[TaskOpsProvision] invalid workflow JSON; skipping', {
            workflowSlug,
          });
          failed += 1;
          continue;
        }
        const workflow = parsed.data;
        if (workflow.metadata?.autoInstall !== true) continue;

        const existing = await ctx.runQuery(
          internal.workflows.provision_defaults_mutations.getProvision,
          { organizationId: args.organizationId, workflowSlug },
        );
        if (existing) {
          // Already provisioned once — never re-provision behind the org's
          // back. Content upgrades reconcile additively in the rollout
          // stage; for now an upgraded file just refreshes the hash.
          skipped += 1;
          continue;
        }

        const contentHash = sha256(content);
        await ctx.runMutation(
          internal.workflows.installations.upsertInstallation,
          {
            organizationId: args.organizationId,
            workflowSlug,
            installedBy: 'system',
            contentHash,
          },
        );

        await ctx.runMutation(
          internal.workflows.provision_defaults_mutations
            .provisionDeclaredWorkflowTriggers,
          {
            organizationId: args.organizationId,
            workflowSlug,
            events: workflow.triggers?.events,
            schedules: workflow.triggers?.schedules,
            activate: true,
          },
        );

        await ctx.runMutation(
          internal.workflows.provision_defaults_mutations.recordProvision,
          { organizationId: args.organizationId, workflowSlug, contentHash },
        );
        provisioned += 1;
        console.log('[TaskOpsProvision] provisioned', {
          org: args.organizationId,
          workflowSlug,
        });
      } catch (error) {
        failed += 1;
        console.error('[TaskOpsProvision] failed for workflow', {
          workflowSlug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { provisioned, skipped, failed };
  },
});
