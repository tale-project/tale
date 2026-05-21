import { syncStreams, vStreamArgs } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { resolveArtifactFiles } from './resolve_files';

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
  /** Number of files in the project. Derived from `files` or 1 for legacy. */
  fileCount: number;
  /** Entry-file path. Synthesized for legacy rows via {@link resolveArtifactFiles}. */
  entryFile: string;
  /** Aggregate byte length of file contents (entry file's content for legacy rows). */
  totalBytes: number;
  createdByMessageId: string;
  lastEditedByMessageId?: string;
  createdAt: number;
  updatedAt: number;
}

function projectListItem(row: Doc<'artifacts'>): ArtifactListItem {
  const resolved = resolveArtifactFiles(row);
  const totalBytes = resolved.files.reduce(
    (acc, f) => acc + f.content.length,
    0,
  );
  return {
    _id: row._id,
    _creationTime: row._creationTime,
    type: row.type,
    title: row.title,
    language: row.language,
    revision: row.revision,
    liveStreamMode: row.liveStreamMode,
    fileCount: resolved.files.length,
    entryFile: resolved.entryFile,
    totalBytes,
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
    const metadata = await canAccessThread(
      ctx,
      artifact.threadId,
      authUser,
      artifact.organizationId,
    );
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
    const metadata = await canAccessThread(
      ctx,
      threadId,
      authUser,
      organizationId,
    );
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

/**
 * Cursor-based subscription to the live tool-input-delta stream for an
 * artifact's create/edit invocation. Thin wrapper around the agent SDK's
 * `syncStreams` — we just authorize access to the artifact's thread and
 * forward the cursor request to the component. The returned `parts` carry
 * the same `{ type: 'tool-input-delta', toolCallId, inputTextDelta }`
 * shape the chat UI already consumes; the canvas pane filters down to its
 * artifact's `toolCallId` and decodes the JSON `content` value
 * client-side. See plan §3 (eventual-mixing-dawn.md).
 */
export const syncArtifactStream = query({
  args: {
    artifactId: v.id('artifacts'),
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, { artifactId, streamArgs }) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return undefined;
    const artifact = await ctx.db.get(artifactId);
    if (!artifact) return undefined;
    const metadata = await canAccessThread(
      ctx,
      artifact.threadId,
      authUser,
      artifact.organizationId,
    );
    if (!metadata || metadata.organizationId !== artifact.organizationId) {
      return undefined;
    }
    if (metadata.status === 'deleted') return undefined;

    return await syncStreams(ctx, components.agent, {
      threadId: artifact.threadId,
      streamArgs,
      includeStatuses: ['streaming'],
    });
  },
});

export const listRevisions = query({
  args: { artifactId: v.id('artifacts') },
  handler: async (ctx, { artifactId }): Promise<Doc<'artifactRevisions'>[]> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];
    const artifact = await ctx.db.get(artifactId);
    if (!artifact) return [];
    const metadata = await canAccessThread(
      ctx,
      artifact.threadId,
      authUser,
      artifact.organizationId,
    );
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
