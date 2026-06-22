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
import { type ActionCtx, internalAction } from '../_generated/server';
import { readJsonFile } from '../lib/file_io';
import { rateLimiter } from '../lib/rate_limiter';
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

/**
 * Opportunistically heal a never-provisioned org: if the autoInstall sweep has
 * never run for it, schedule one (rate-limited per org). Called fire-and-forget
 * from run admission — the current run is still admitted via the liveness gate's
 * fail-open; this just ensures the org gets provisioned and leaves fail-open
 * promptly, instead of relying solely on the org-creation hook / deploy runner.
 *
 * Early-returns when the org is already provisioned, so it never resurrects a
 * deliberately-emptied org (those retain their provision rows). Safe to call on
 * every admission: the `hasAnyProvision` check short-circuits provisioned orgs,
 * and the rate limiter + the sweep's own per-agent idempotency collapse
 * concurrent calls to a single provision.
 */
export async function ensureAgentsProvisioned(
  ctx: ActionCtx,
  organizationId: string,
  orgSlug: string,
): Promise<void> {
  const provisioned = await ctx.runQuery(
    internal.agents.provision_defaults_mutations.hasAnyProvisionQuery,
    { organizationId },
  );
  if (provisioned) return;

  // Tolerate the rate-limiter component being absent (convexTest doesn't
  // register it) — skip the heal rather than throw on the run-admission path.
  try {
    const { ok } = await rateLimiter.limit(ctx, 'provision:autoheal', {
      key: organizationId,
      throws: false,
    });
    if (!ok) return;
  } catch (err) {
    console.warn(
      '[AgentProvision] autoheal rate-limit check failed; skipping',
      err,
    );
    return;
  }

  await ctx.scheduler.runAfter(
    0,
    internal.agents.provision_defaults.syncDefaultAgentInstallations,
    { organizationId, orgSlug },
  );
}

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

    // Sweep sentinel: record a reserved provision row so an org whose catalog
    // has ZERO autoInstall agents still flips `hasAnyProvision` true and leaves
    // the liveness gate's fail-open — without it the gate would re-schedule this
    // no-op sweep on every run admission. `__sweep__` can never be a real agent
    // slug (the `__` separator is reserved), so nothing reads it as an agent.
    await ctx.runMutation(
      internal.agents.provision_defaults_mutations.recordProvision,
      {
        organizationId: args.organizationId,
        agentSlug: '__sweep__',
        contentHash: 'sweep',
      },
    );

    console.log('[AgentProvision] run', {
      org: args.organizationId,
      provisioned,
      skipped,
      failed,
    });
    return { provisioned, skipped, failed };
  },
});
