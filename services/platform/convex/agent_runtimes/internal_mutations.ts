/**
 * Runtime registry writes, driven by the `tale-daemon` REST endpoints.
 *
 * `heartbeatRuntime` is the daemon's liveness tick AND the org's external-run
 * watchdog: it refreshes the registry rows, renews the leases of every run
 * this daemon holds, collects pending cancellations for the response, and
 * opportunistically sweeps the org's expired runs (a live daemon keeps its
 * org healthy without any fleet-wide cron; orgs without daemons are covered
 * by the self-scheduled sweeps from enqueue/claim).
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalMutation } from '../_generated/server';
import { EXTERNAL_CLAIM_LEASE_MS } from '../external_runs/schema';
import { runtimeCapabilitiesValidator } from './schema';

const MAX_ADAPTERS_PER_DAEMON = 12;
const MAX_WORKSPACE_KEYS = 50;

export const registerRuntime = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    daemonId: v.string(),
    name: v.optional(v.string()),
    adapters: v.array(
      v.object({
        adapterType: v.string(),
        version: v.optional(v.string()),
        capabilities: v.optional(runtimeCapabilitiesValidator),
      }),
    ),
    workspaceKeys: v.optional(v.array(v.string())),
  },
  returns: v.object({ registered: v.number() }),
  handler: async (ctx, args): Promise<{ registered: number }> => {
    const now = Date.now();
    const adapters = args.adapters.slice(0, MAX_ADAPTERS_PER_DAEMON);
    const workspaceKeys = args.workspaceKeys?.slice(0, MAX_WORKSPACE_KEYS);

    // Upsert one row per (daemon, adapter); drop rows for adapters the
    // daemon no longer advertises (uninstalled CLI).
    const advertised = new Set(adapters.map((a) => a.adapterType));
    for await (const existing of ctx.db
      .query('agentRuntimes')
      .withIndex('by_org_daemon', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('daemonId', args.daemonId),
      )) {
      if (!advertised.has(existing.adapterType)) {
        await ctx.db.delete(existing._id);
      }
    }

    for (const adapter of adapters) {
      const existing = await ctx.db
        .query('agentRuntimes')
        .withIndex('by_org_daemon_adapter', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('daemonId', args.daemonId)
            .eq('adapterType', adapter.adapterType),
        )
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          name: args.name ?? existing.name,
          version: adapter.version,
          capabilities: adapter.capabilities,
          workspaceKeys,
          lastHeartbeatAt: now,
        });
      } else {
        await ctx.db.insert('agentRuntimes', {
          organizationId: args.organizationId,
          daemonId: args.daemonId,
          adapterType: adapter.adapterType,
          name: args.name,
          version: adapter.version,
          capabilities: adapter.capabilities,
          workspaceKeys,
          createdBy: args.userId,
          registeredAt: now,
          lastHeartbeatAt: now,
        });
      }
    }
    console.log(
      `[ExternalRuns] runtime registered org=${args.organizationId} daemon=${args.daemonId} adapters=${adapters.map((a) => a.adapterType).join(',')}`,
    );
    return { registered: adapters.length };
  },
});

export const heartbeatRuntime = internalMutation({
  args: {
    organizationId: v.string(),
    daemonId: v.string(),
  },
  returns: v.object({
    known: v.boolean(),
    cancel: v.array(v.id('externalRuns')),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ known: boolean; cancel: Id<'externalRuns'>[] }> => {
    const now = Date.now();
    let known = false;
    for await (const row of ctx.db
      .query('agentRuntimes')
      .withIndex('by_org_daemon', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('daemonId', args.daemonId),
      )) {
      known = true;
      await ctx.db.patch(row._id, { lastHeartbeatAt: now });
    }

    // Renew the leases on every run this daemon holds and collect the
    // server-requested cancellations for the response.
    const cancel: Id<'externalRuns'>[] = [];
    for (const status of ['claimed', 'running'] as const) {
      for await (const run of ctx.db
        .query('externalRuns')
        .withIndex('by_daemon_status', (q) =>
          q.eq('claimedByDaemonId', args.daemonId).eq('status', status),
        )) {
        if (run.organizationId !== args.organizationId) continue;
        await ctx.db.patch(run._id, {
          leaseExpiresAt: now + EXTERNAL_CLAIM_LEASE_MS,
        });
        if (run.cancelRequested) cancel.push(run._id);
      }
    }

    // Opportunistic org watchdog (bounded; cheap when nothing expired).
    await ctx.runMutation(
      internal.external_runs.internal_mutations.sweepExternalRuns,
      { organizationId: args.organizationId },
    );

    return { known, cancel };
  },
});
