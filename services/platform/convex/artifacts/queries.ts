import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';

const MAX_LIST_BY_THREAD = 50;

export const getById = query({
  args: { artifactId: v.id('artifacts') },
  handler: async (ctx, { artifactId }): Promise<Doc<'artifacts'> | null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;
    const artifact = await ctx.db.get(artifactId);
    if (!artifact) return null;
    const metadata = await canAccessThread(ctx, artifact.threadId, authUser);
    if (!metadata || metadata.organizationId !== artifact.organizationId) {
      return null;
    }
    return artifact;
  },
});

export const listByThread = query({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    paginationOpts: v.optional(paginationOptsValidator),
  },
  handler: async (
    ctx,
    { organizationId, threadId, paginationOpts },
  ): Promise<Doc<'artifacts'>[]> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];
    const metadata = await canAccessThread(ctx, threadId, authUser);
    if (!metadata || metadata.organizationId !== organizationId) return [];

    const cursor = ctx.db
      .query('artifacts')
      .withIndex('by_organizationId_and_thread', (q) =>
        q.eq('organizationId', organizationId).eq('threadId', threadId),
      )
      .order('desc');

    const limit = Math.min(
      paginationOpts?.numItems ?? MAX_LIST_BY_THREAD,
      MAX_LIST_BY_THREAD,
    );
    const newestFirst = await cursor.take(limit);
    return newestFirst.toReversed();
  },
});

export const listRevisions = query({
  args: { artifactId: v.id('artifacts') },
  handler: async (ctx, { artifactId }): Promise<Doc<'artifactRevisions'>[]> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];
    const artifact = await ctx.db.get(artifactId);
    if (!artifact) return [];
    const metadata = await canAccessThread(ctx, artifact.threadId, authUser);
    if (!metadata || metadata.organizationId !== artifact.organizationId) {
      return [];
    }
    const rows: Doc<'artifactRevisions'>[] = [];
    for await (const row of ctx.db
      .query('artifactRevisions')
      .withIndex('by_artifact', (q) => q.eq('artifactId', artifactId))
      .order('asc')) {
      rows.push(row);
    }
    return rows;
  },
});
