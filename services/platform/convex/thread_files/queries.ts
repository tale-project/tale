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
import {
  buildBlobServeUrl,
  toPublicUrl,
} from '../lib/helpers/public_storage_url';
import { getAuthUserIdentity } from '../lib/rls';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { convexStorageId, isS3Ref } from '../lib/storage/blob_ref';
import { getBranchAncestorThreadIds } from '../threads/get_branch_ancestor_thread_ids';
import { getDelegateSubThreadIds } from '../threads/get_delegate_sub_thread_ids';

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

    // The active agent's own files take precedence: read the route thread first
    // and remember its paths, then fill in delegated files for paths it doesn't
    // already have. A path written on BOTH the route thread and a delegate's
    // sub-thread is two independent agents' work, not two versions of one file —
    // surfacing the route thread's copy keeps the user looking at what the
    // foreground agent produced.
    const byPath = new Map<string, ThreadFileItem>();
    const collect = (r: {
      organizationId: string;
      path: string;
      size: number;
      contentType: string;
      source: 'user_upload' | 'agent_write' | 'run_output';
      renderHint?: ThreadFileItem['renderHint'];
      updatedAt: number;
      createdAt: number;
    }) => {
      // Defensive: a thread that's accessible to this user must still belong to
      // the org the URL claims. Filter out any cross-org rows in case a future
      // bug seeds stray rows under the same `threadId`. This is also the only
      // access gate on delegate sub-threads (which carry no `threadMetadata`
      // row to re-authorize against) — see `getDelegateSubThreadIds`.
      if (r.organizationId !== args.organizationId) return;
      if (byPath.has(r.path)) return;
      byPath.set(r.path, {
        path: r.path,
        size: r.size,
        contentType: r.contentType,
        source: r.source,
        renderHint: r.renderHint,
        updatedAt: r.updatedAt,
        createdAt: r.createdAt,
      });
    };

    // `filesBefore` caps an ancestor's surfaced files at its fork point — rows
    // touched after the branch split off belong to a future this branch didn't
    // take. Cut on `updatedAt`, not `createdAt`: `upsertThreadFile` patches a
    // same-path rewrite in place (preserving the original `createdAt`, bumping
    // only `updatedAt`), so a pre-fork file edited post-fork keeps an old
    // `createdAt` and would otherwise leak its later content into this branch.
    // `undefined` (the active tip, or a legacy branch row) means no cut.
    const collectThreadFiles = async (
      threadId: string,
      filesBefore?: number,
    ) => {
      for await (const r of ctx.db
        .query('threadFiles')
        .withIndex('by_thread_and_updatedAt', (q) => q.eq('threadId', threadId))
        .order('desc')) {
        if (filesBefore !== undefined && r.updatedAt > filesBefore) continue;
        collect(r);
      }
    };

    // Branching forks the SAME conversation: a file written before the fork
    // lives on the pre-fork (ancestor) thread or its sub-threads, so looking
    // only at the active branch tip drops it from the Canvas. Walk the branch
    // ancestor chain (active tip → … → root) and union every thread's files +
    // its delegate sub-threads' files, cutting each ancestor at its fork point.
    // The chain is ordered tip-first, and `collect` keeps the first writer of a
    // path, so the branch the user is viewing wins on a path collision with an
    // ancestor.
    const chain = await getBranchAncestorThreadIds(ctx, args.threadId);
    for (const hop of chain) {
      await collectThreadFiles(hop.threadId, hop.filesBefore);

      // Union files written by delegate sub-threads (the agent the user is
      // talking to may hand work to a Coder/Researcher that writes to its own
      // thread). A delegate's files are subject to the same fork cut as the
      // ancestor that owns it.
      const subThreadIds = await getDelegateSubThreadIds(ctx, hop.threadId);
      for (const subThreadId of subThreadIds) {
        await collectThreadFiles(subThreadId, hop.filesBefore);
      }
    }

    return Array.from(byPath.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
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

    // Resolve the bytes by path across the SAME set of threads (and the SAME
    // fork-point cut) that `listThreadFilesForUser` enumerates: the branch
    // ancestor chain (active tip → … → root) and, for each thread in it, its
    // delegate sub-threads. A file shown in the canvas can therefore always be
    // opened — and a file the list cut off at the fork point stays unreachable
    // here too. Tip-first ordering makes the viewed branch's copy win on a path
    // collision, matching the list.
    const findOnThread = async (threadId: string, filesBefore?: number) => {
      const row = await ctx.db
        .query('threadFiles')
        .withIndex('by_thread_and_path', (q) =>
          q.eq('threadId', threadId).eq('path', args.path),
        )
        .first();
      if (!row || row.organizationId !== args.organizationId) return null;
      // Cut on `updatedAt`, not `createdAt` — see collectThreadFiles above for
      // why a same-path post-fork rewrite keeps a stale `createdAt`.
      if (filesBefore !== undefined && row.updatedAt > filesBefore) return null;
      return row;
    };

    const chain = await getBranchAncestorThreadIds(ctx, args.threadId);
    let row: Awaited<ReturnType<typeof findOnThread>> = null;
    for (const hop of chain) {
      row = await findOnThread(hop.threadId, hop.filesBefore);
      if (row) break;
      const subThreadIds = await getDelegateSubThreadIds(ctx, hop.threadId);
      for (const subThreadId of subThreadIds) {
        row = await findOnThread(subThreadId, hop.filesBefore);
        if (row) break;
      }
      if (row) break;
    }
    if (!row) return null;

    // Backend-aware serve: a Convex `_storage` id gets the direct (proxied)
    // storage URL as before; an `s3:` ref gets the `/storage?ref=…&org=…`
    // route URL — a query cannot presign S3, so the node route 302s to a
    // short-lived presigned GET when the canvas fetches it. Mirrors
    // files/queries.ts:resolveBlobUrl.
    let url: string | null;
    if (isS3Ref(row.storageId)) {
      url = buildBlobServeUrl(String(row.storageId), row.organizationId);
    } else {
      const convexId = convexStorageId(row.storageId);
      const raw = convexId === null ? null : await ctx.storage.getUrl(convexId);
      url = raw ? toPublicUrl(raw) : null;
    }
    if (!url) return null;

    return {
      url,
      size: row.size,
      contentType: row.contentType,
      renderHint: row.renderHint,
      updatedAt: row.updatedAt,
    };
  },
});
