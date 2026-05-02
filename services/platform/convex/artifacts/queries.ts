import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';

const MAX_LIST_BY_THREAD = 50;

/**
 * Metadata-only projection of an artifact row, returned by `listByThread`.
 * The full `content` / `streamingContent` / `streamingPatches` fields are
 * deliberately excluded — neither caller (ArtifactBar, MessageArtifactPills)
 * reads them, and including them shipped up to ~40 MB per Convex push for a
 * thread with many large artifacts.
 *
 * Detail views call `getById` for the full document.
 */
export interface ArtifactListItem {
  _id: Doc<'artifacts'>['_id'];
  _creationTime: number;
  type: Doc<'artifacts'>['type'];
  title: string;
  language?: string;
  revision: number;
  liveStreamMode?: Doc<'artifacts'>['liveStreamMode'];
  createdByMessageId: string;
  lastEditedByMessageId?: string;
  createdAt: number;
  updatedAt: number;
}

function projectListItem(row: Doc<'artifacts'>): ArtifactListItem {
  return {
    _id: row._id,
    _creationTime: row._creationTime,
    type: row.type,
    title: row.title,
    language: row.language,
    revision: row.revision,
    liveStreamMode: row.liveStreamMode,
    createdByMessageId: row.createdByMessageId,
    lastEditedByMessageId: row.lastEditedByMessageId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

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

/**
 * List the most recent artifacts for a thread, capped at MAX_LIST_BY_THREAD
 * (50). Returns metadata only — see `ArtifactListItem`. The previous
 * `paginationOpts` validator was misleading: only `numItems` was honoured and
 * the cursor was silently dropped, so threads with >50 artifacts truncated
 * older entries with no recovery path. We replace it with an explicit
 * `limit?: number` argument; if real pagination is needed it should be a
 * separate API surface with a proper cursor.
 */
export const listByThread = query({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { organizationId, threadId, limit },
  ): Promise<ArtifactListItem[]> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];
    const metadata = await canAccessThread(ctx, threadId, authUser);
    if (!metadata || metadata.organizationId !== organizationId) return [];

    const cap = Math.max(
      1,
      Math.min(limit ?? MAX_LIST_BY_THREAD, MAX_LIST_BY_THREAD),
    );
    const newestFirst = await ctx.db
      .query('artifacts')
      .withIndex('by_organizationId_and_thread', (q) =>
        q.eq('organizationId', organizationId).eq('threadId', threadId),
      )
      .order('desc')
      .take(cap);
    return newestFirst.toReversed().map(projectListItem);
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
