/**
 * Public queries over the thread workspace (`threadFiles` table).
 *
 * These power the chat canvas: the right pane subscribes to
 * `listThreadFilesForUser` for the current thread and asks
 * `getThreadFileContentUrl` for the bytes of whichever file the user
 * selected. Both are membership-gated via `canAccessThread`, so an org
 * member who hasn't been invited to a particular thread cannot enumerate
 * or download its files.
 */

import { v } from 'convex/values';

import { query } from '../_generated/server';
import { toPublicUrl } from '../lib/helpers/public_storage_url';
import { getAuthUserIdentity } from '../lib/rls';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';

export interface ThreadFileItem {
  path: string;
  size: number;
  contentType: string;
  source: 'user_upload' | 'agent_write' | 'run_output';
  renderHint?:
    | 'html'
    | 'svg'
    | 'mermaid'
    | 'markdown'
    | 'code'
    | 'image'
    | 'attachment';
  updatedAt: number;
  createdAt: number;
}

export const listThreadFilesForUser = query({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<ThreadFileItem[]> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];

    const metadata = await canAccessThread(
      ctx,
      args.threadId,
      authUser,
      args.organizationId,
    );
    if (!metadata) return [];

    const rows = await ctx.db
      .query('threadFiles')
      .withIndex('by_thread_and_updatedAt', (q) =>
        q.eq('threadId', args.threadId),
      )
      .order('desc')
      .collect();

    // Defensive: a thread that's accessible to this user must still belong to
    // the org the URL claims. Filter out any cross-org rows in case a future
    // bug seeds stray rows under the same `threadId`.
    return rows
      .filter((r) => r.organizationId === args.organizationId)
      .map((r) => ({
        path: r.path,
        size: r.size,
        contentType: r.contentType,
        source: r.source,
        renderHint: r.renderHint,
        updatedAt: r.updatedAt,
        createdAt: r.createdAt,
      }));
  },
});

/**
 * Returns a signed storage URL for the requested workspace file plus the
 * metadata the canvas needs to dispatch the right renderer. The URL is
 * short-lived (Convex's default storage URL TTL) — the canvas refetches
 * on file switch / `updatedAt` change.
 */
export const getThreadFileContentUrl = query({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
    path: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    url: string;
    size: number;
    contentType: string;
    renderHint?:
      | 'html'
      | 'svg'
      | 'mermaid'
      | 'markdown'
      | 'code'
      | 'image'
      | 'attachment';
    updatedAt: number;
  } | null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    const metadata = await canAccessThread(
      ctx,
      args.threadId,
      authUser,
      args.organizationId,
    );
    if (!metadata) return null;

    const row = await ctx.db
      .query('threadFiles')
      .withIndex('by_thread_and_path', (q) =>
        q.eq('threadId', args.threadId).eq('path', args.path),
      )
      .first();
    if (!row || row.organizationId !== args.organizationId) return null;

    const url = await ctx.storage.getUrl(row.storageId);
    if (!url) return null;

    return {
      url: toPublicUrl(url),
      size: row.size,
      contentType: row.contentType,
      renderHint: row.renderHint,
      updatedAt: row.updatedAt,
    };
  },
});
