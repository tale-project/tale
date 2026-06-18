/**
 * Member-mirror reconciliation (defense-in-depth).
 *
 * Inline write-path sync (members/mutations.ts, the auth org hooks, the auth
 * after-middleware) keeps `memberMirror` current in the common case. This
 * hourly cron is the safety net: it re-derives the mirror from Better Auth
 * (the source of truth) so it converges after any missed beat or partial
 * failure, AND backfills members that predate the mirror (e.g. on first deploy
 * of this feature). Same role as the `reconcileAllConfigCaches` cron — the DB
 * mirror is never authoritative, so a stale beat self-heals here.
 *
 * Bounded: a fixed number of orgs per run, resuming from a persisted Better
 * Auth organization-pagination cursor, so one tick can't run unbounded and a
 * large deployment is swept over several hours.
 */

import { v } from 'convex/values';

import { isRecord, getString, getNumber } from '../../lib/utils/type-utils';
import { components, internal } from '../_generated/api';
import { internalAction, internalMutation } from '../_generated/server';
import { upsertMemberMirror, upsertTeamMemberMirror } from './mirror_sync';

const JOB = 'memberMirrorReconcile';
const ORGS_PER_RUN = 25;
const MEMBERS_PAGE = 200;

/**
 * Reconcile the mirror for a single org against Better Auth: upsert every live
 * member, then delete mirror rows whose member no longer exists in the source.
 */
export const reconcileOneOrg = internalMutation({
  args: { organizationId: v.string() },
  returns: v.object({ upserted: v.number(), deleted: v.number() }),
  handler: async (ctx, args) => {
    // Collect the org's live members from Better Auth (the source of truth).
    const liveMemberIds = new Set<string>();
    let upserted = 0;
    let cursor: string | null = null;
    for (;;) {
      const result: {
        page: unknown[];
        isDone?: boolean;
        continueCursor?: string;
      } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: { cursor, numItems: MEMBERS_PAGE },
        where: [
          {
            field: 'organizationId',
            value: args.organizationId,
            operator: 'eq',
          },
        ],
      });
      if (!result || result.page.length === 0) break;
      for (const raw of result.page) {
        if (!isRecord(raw)) continue;
        const memberId = getString(raw, '_id');
        const userId = getString(raw, 'userId');
        if (!memberId || !userId) continue;
        liveMemberIds.add(memberId);
        await upsertMemberMirror(ctx, {
          memberId,
          userId,
          organizationId: args.organizationId,
          role: getString(raw, 'role') ?? 'member',
          createdAt: getNumber(raw, 'createdAt') ?? Date.now(),
        });
        upserted += 1;
      }
      if (result.isDone || result.continueCursor === cursor) break;
      cursor = result.continueCursor ?? null;
    }

    // Delete mirror rows whose member is gone from the source.
    let deleted = 0;
    for await (const row of ctx.db
      .query('memberMirror')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (!liveMemberIds.has(row.memberId)) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }

    // Reconcile the teamMember mirror for every team in this org (upsert/delete
    // counts fold into the same totals). teamMember is keyed by team, so we walk
    // the org's teams, then each team's members.
    let teamCursor: string | null = null;
    for (;;) {
      const teamsRes: {
        page: unknown[];
        isDone?: boolean;
        continueCursor?: string;
      } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'team',
        paginationOpts: { cursor: teamCursor, numItems: MEMBERS_PAGE },
        where: [
          {
            field: 'organizationId',
            value: args.organizationId,
            operator: 'eq',
          },
        ],
      });
      if (!teamsRes || teamsRes.page.length === 0) break;
      for (const rawTeam of teamsRes.page) {
        if (!isRecord(rawTeam)) continue;
        const teamId = getString(rawTeam, '_id');
        if (!teamId) continue;

        const liveTeamMemberIds = new Set<string>();
        let tmCursor: string | null = null;
        for (;;) {
          const tmRes: {
            page: unknown[];
            isDone?: boolean;
            continueCursor?: string;
          } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
            model: 'teamMember',
            paginationOpts: { cursor: tmCursor, numItems: MEMBERS_PAGE },
            where: [{ field: 'teamId', value: teamId, operator: 'eq' }],
          });
          if (!tmRes || tmRes.page.length === 0) break;
          for (const raw of tmRes.page) {
            if (!isRecord(raw)) continue;
            const teamMemberId = getString(raw, '_id');
            const tmUserId = getString(raw, 'userId');
            if (!teamMemberId || !tmUserId) continue;
            liveTeamMemberIds.add(teamMemberId);
            await upsertTeamMemberMirror(ctx, {
              teamMemberId,
              userId: tmUserId,
              teamId,
              createdAt: getNumber(raw, 'createdAt') ?? Date.now(),
            });
            upserted += 1;
          }
          if (tmRes.isDone || tmRes.continueCursor === tmCursor) break;
          tmCursor = tmRes.continueCursor ?? null;
        }

        for await (const row of ctx.db
          .query('teamMemberMirror')
          .withIndex('by_teamId', (q) => q.eq('teamId', teamId))) {
          if (!liveTeamMemberIds.has(row.teamMemberId)) {
            await ctx.db.delete(row._id);
            deleted += 1;
          }
        }
      }
      if (teamsRes.isDone || teamsRes.continueCursor === teamCursor) break;
      teamCursor = teamsRes.continueCursor ?? null;
    }

    return { upserted, deleted };
  },
});

/** Read the persisted reconcile cursor. */
export const readReconcileCursor = internalMutation({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const row = await ctx.db
      .query('memberMirrorReconcileCursor')
      .withIndex('by_job', (q) => q.eq('job', JOB))
      .first();
    return row?.cursor ?? null;
  },
});

/** Persist the reconcile cursor (null = start over next run). */
export const writeReconcileCursor = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('memberMirrorReconcileCursor')
      .withIndex('by_job', (q) => q.eq('job', JOB))
      .first();
    const cursor = args.cursor ?? undefined;
    if (row) {
      await ctx.db.patch(row._id, { cursor, updatedAt: Date.now() });
    } else {
      await ctx.db.insert('memberMirrorReconcileCursor', {
        job: JOB,
        cursor,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

/**
 * Cron entry: reconcile up to ORGS_PER_RUN orgs, resuming from the persisted
 * cursor and wrapping around when the org list is exhausted.
 */
export const reconcileMemberMirrors = internalAction({
  args: {},
  returns: v.object({
    orgsScanned: v.number(),
    wrappedAround: v.boolean(),
  }),
  handler: async (ctx) => {
    let cursor: string | null = await ctx.runMutation(
      internal.members.mirror_reconciliation.readReconcileCursor,
      {},
    );

    let orgsScanned = 0;
    let wrappedAround = false;

    try {
      const result: {
        page: unknown[];
        isDone?: boolean;
        continueCursor?: string;
      } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'organization',
        paginationOpts: { cursor, numItems: ORGS_PER_RUN },
        where: [],
      });

      for (const raw of result?.page ?? []) {
        if (!isRecord(raw)) continue;
        const orgId = getString(raw, '_id');
        if (!orgId) continue;
        await ctx.runMutation(
          internal.members.mirror_reconciliation.reconcileOneOrg,
          { organizationId: orgId },
        );
        orgsScanned += 1;
      }

      // Advance the cursor; wrap to the start once the list is exhausted.
      if (result?.isDone || !result?.continueCursor) {
        cursor = null;
        wrappedAround = true;
      } else {
        cursor = result.continueCursor;
      }
    } catch (err) {
      // A stale cursor (org list changed between runs) can make the adapter
      // throw. Reset so the next run starts cleanly — reconcile is idempotent.
      console.warn(
        '[member-mirror] reconcile run failed; resetting cursor',
        err instanceof Error ? err.message : err,
      );
      cursor = null;
    }

    await ctx.runMutation(
      internal.members.mirror_reconciliation.writeReconcileCursor,
      { cursor },
    );

    return { orgsScanned, wrappedAround };
  },
});
