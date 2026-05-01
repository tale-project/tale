import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { getAuthUserIdentity, getOrganizationMember } from '../lib/rls';

export const getById = query({
  args: { artifactId: v.id('artifacts') },
  handler: async (ctx, { artifactId }): Promise<Doc<'artifacts'> | null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;
    const artifact = await ctx.db.get(artifactId);
    if (!artifact) return null;
    try {
      await getOrganizationMember(ctx, artifact.organizationId, authUser);
    } catch {
      return null;
    }
    return artifact;
  },
});

export const listByThread = query({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
  },
  handler: async (
    ctx,
    { organizationId, threadId },
  ): Promise<Doc<'artifacts'>[]> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];
    try {
      await getOrganizationMember(ctx, organizationId, authUser);
    } catch {
      return [];
    }
    const rows: Doc<'artifacts'>[] = [];
    for await (const row of ctx.db
      .query('artifacts')
      .withIndex('by_organizationId_and_thread', (q) =>
        q.eq('organizationId', organizationId).eq('threadId', threadId),
      )
      .order('asc')) {
      rows.push(row);
    }
    return rows;
  },
});

export const listRevisions = query({
  args: { artifactId: v.id('artifacts') },
  handler: async (ctx, { artifactId }): Promise<Doc<'artifactRevisions'>[]> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];
    const artifact = await ctx.db.get(artifactId);
    if (!artifact) return [];
    try {
      await getOrganizationMember(ctx, artifact.organizationId, authUser);
    } catch {
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
