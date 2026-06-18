'use node';

/**
 * Default-agent provisioner: makes `metadata.autoInstall` agent files actually
 * LIVE for an organization. An agent file on disk is catalog-only until it has
 * an `agentInstallations` row (the roster gate filters to installed && enabled).
 * This action walks the org's agents dir and, for every autoInstall file not
 * yet provisioned (tracked in `agentDefaultProvisions`):
 *
 *   1. upserts an enabled `agentInstallations` row (installedBy 'system'),
 *   2. records the provision so the org is never re-provisioned behind its
 *      back (a later uninstall/disable sticks).
 *
 * Invoked from the org-creation hook (after the scaffold copies the catalog)
 * and from the all-orgs deploy runner. Self-retries when the agents dir does
 * not exist yet (scaffold still running). Mirrors
 * `workflows/provision_defaults.ts`.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { readJsonFile } from '../lib/file_io';
import {
  MAX_FILE_SIZE_BYTES,
  effectiveAgentSlug,
  parseAgentJson,
  resolveAgentFilePathFromRelative,
  walkAgentRelativePaths,
  type AgentJsonConfig,
} from './file_utils';

const RETRY_DELAY_MS = 30_000;
const MAX_ATTEMPTS = 3;

export const syncDefaultAgentInstallations = internalAction({
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

    const relPaths = await walkAgentRelativePaths(args.orgSlug);
    if (relPaths.length === 0 && attempt < MAX_ATTEMPTS) {
      // Scaffold may still be copying the catalog — retry a bounded number of
      // times, then give up quietly (the all-orgs runner can re-run).
      await ctx.scheduler.runAfter(
        RETRY_DELAY_MS,
        internal.agents.provision_defaults.syncDefaultAgentInstallations,
        { ...args, attempt: attempt + 1 },
      );
      return { provisioned: 0, skipped: 0, failed: 0 };
    }

    let provisioned = 0;
    let skipped = 0;
    let failed = 0;

    for (const relativePath of relPaths) {
      try {
        const read = await readJsonFile<AgentJsonConfig>(
          resolveAgentFilePathFromRelative(args.orgSlug, relativePath),
          MAX_FILE_SIZE_BYTES,
          parseAgentJson,
        );
        if (!read.ok) {
          failed += 1;
          continue;
        }
        if (read.data.metadata?.autoInstall !== true) continue;

        const agentSlug = effectiveAgentSlug(read.data, relativePath);
        const existing = await ctx.runQuery(
          internal.agents.provision_defaults_mutations.getProvision,
          { organizationId: args.organizationId, agentSlug },
        );
        if (existing) {
          skipped += 1;
          continue;
        }

        await ctx.runMutation(
          internal.agents.installations.upsertInstallation,
          {
            organizationId: args.organizationId,
            agentSlug,
            installedBy: 'system',
            contentHash: read.hash,
            enabled: true,
          },
        );
        await ctx.runMutation(
          internal.agents.provision_defaults_mutations.recordProvision,
          {
            organizationId: args.organizationId,
            agentSlug,
            contentHash: read.hash,
          },
        );
        provisioned += 1;
      } catch (error) {
        failed += 1;
        console.error('[AgentProvision] failed for agent file', {
          relativePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    console.log('[AgentProvision] run', {
      org: args.organizationId,
      provisioned,
      skipped,
      failed,
    });
    return { provisioned, skipped, failed };
  },
});
