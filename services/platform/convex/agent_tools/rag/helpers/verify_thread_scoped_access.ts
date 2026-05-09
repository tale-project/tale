/**
 * Per-storage-id authorization for `rag_search` (search and retrieve ops).
 *
 * Three access classes — see `fileMetadata.threadId` JSDoc:
 *   - Document Hub: `documentId` set, `threadId` unset → org-wide knowledge.
 *     Authorized when same-org. (Agent's pre-configured allow-list, computed
 *     by `getAgentScopedFileIds`, is a stricter sub-policy applied
 *     separately for default search; explicit fileIds skip that.)
 *   - Chat upload (post thread-binding): `threadId` set →
 *     authorized only when the bound `threadId` is in the caller's
 *     accessible-thread set (current thread + ancestors via the
 *     delegation chain).
 *   - Legacy / integration: both unset → grandfather to same-org check.
 *     New uploads write `threadId`; legacy rows age out via retention.
 *
 * Cross-org `_storage` ids — no matching `fileMetadata` row, or row's
 * `organizationId` mismatches — are refused.
 *
 * Caller must compute `accessibleThreadIds` in action context (the
 * delegation chain lives in the agent component's per-thread summary,
 * which is not reachable from a query). See
 * `threads/get_thread_ancestor_chain.ts`.
 */
import { v } from 'convex/values';

import type { Id } from '../../../_generated/dataModel';
import { internalQuery } from '../../../_generated/server';

export const verifyStorageIdsInThreadScope = internalQuery({
  args: {
    organizationId: v.string(),
    /**
     * The thread + every ancestor the caller is authorized to read from.
     * Empty for non-chat callers (e.g. workflows) — those callers reach
     * only Document Hub / legacy files via the same-org grandfather.
     */
    accessibleThreadIds: v.array(v.string()),
    storageIds: v.array(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const allowedThreadIds = new Set(args.accessibleThreadIds);

    for (const storageId of args.storageIds) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- storage id is a wire string; the by_storageId index lookup expects the branded Id<'_storage'>
      const branded = storageId as unknown as Id<'_storage'>;
      const meta = await ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', branded))
        .first();
      if (!meta) return false;
      if (meta.organizationId !== args.organizationId) return false;

      if (meta.threadId !== undefined) {
        // Chat upload bound to a thread — must be in caller's chain.
        if (!allowedThreadIds.has(meta.threadId)) return false;
      }
      // Else: documentId set (Document Hub) or both unset (legacy /
      // integration) → same-org grandfather, already passed.
    }
    return true;
  },
});
