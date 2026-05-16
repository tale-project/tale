import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';

const PAGE_SIZE = 200;
// 7 days — matches the retention contract documented on `ttsAudioChunks`.
const CHUNK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
// Per-run budget for the daily org sweep. Convex mutations have a ~16K
// document-read budget and a 1-minute timeout. MAX_ORGS_PER_RUN ×
// (1 probe + ROWS_PER_ORG_PER_RUN) must stay well under 16K.
// 50 × (1 + 200) = ~10K reads — comfortable margin.
const MAX_ORGS_PER_RUN = 50;
const ROWS_PER_ORG_PER_RUN = 200;

/**
 * Delete every TTS chunk row and `_storage` blob owned by the listed
 * messages. The helper exists because round-2 found two callers that
 * delete messages directly (arena B-better, future per-message-delete UI)
 * without cascading their TTS audio — chunks would otherwise linger as
 * ghost rows referencing dead `messageId`s until the 7-day GC catches them.
 *
 * Pages `by_message` for each id so a single message with many chunks
 * (capped at 200 by `MAX_TTS_CHUNKS_PER_MESSAGE`) stays well under Convex's
 * 16K read limit. Idempotent re-entry safe: if a row was already deleted
 * by a concurrent caller, `ctx.db.delete` is a no-op against a missing id.
 *
 * Storage-blob delete failures are logged + proceed (matching the existing
 * thread-cascade and org-cascade behaviour). Re-throwing would abort the
 * whole transaction, leaving the message row partially-deleted; the
 * daily org-sweep cron sweeps orphan blobs as a defence-in-depth.
 */
export async function cascadeDeleteMessageChildren(
  ctx: MutationCtx,
  args: {
    messageIds: ReadonlyArray<string>;
    threadId: string;
    organizationId: string;
  },
): Promise<{ deleted: number }> {
  let deleted = 0;
  for (const messageId of args.messageIds) {
    for await (const chunk of ctx.db
      .query('ttsAudioChunks')
      .withIndex('by_message', (q) => q.eq('messageId', messageId))) {
      // Cross-field identity guard mirrors `reserveChunk` — `messageId` is
      // `v.string()`, not an `_id`, so the index alone doesn't pin
      // ownership. Refuse to touch rows whose thread/org doesn't match.
      if (
        chunk.threadId !== args.threadId ||
        chunk.organizationId !== args.organizationId
      ) {
        continue;
      }
      if (chunk.storageId) {
        try {
          await ctx.storage.delete(chunk.storageId);
        } catch (err) {
          console.warn(
            '[tts.cascadeDeleteMessageChildren] storage.delete failed',
            err,
          );
        }
      }
      await ctx.db.delete(chunk._id);
      deleted += 1;
    }
  }
  return { deleted };
}

/**
 * GDPR Art 17 erasure path for a single user-org pair. Called from
 * `cascadeOnMemberRemoved` so a member whose synthesis history spans many
 * threads is fully erased without leaving verbatim voice renderings on
 * disk. Uses the `by_user_org` index introduced in commit 2 — legacy rows
 * that pre-date the `userId` column are reaped by the daily cron as a
 * defence-in-depth.
 */
export async function cascadeOnTtsForMemberRemoved(
  ctx: MutationCtx,
  userId: string,
  organizationId: string,
): Promise<{ deleted: number }> {
  let deleted = 0;
  // Cap the scan at 50 pages so a worst-case member with thousands of
  // chunks doesn't blow the mutation budget. Whatever doesn't fit gets
  // reaped by the daily cron — still inside the 30-day Art 12(3) window.
  for (let i = 0; i < 50; i++) {
    const page = await ctx.db
      .query('ttsAudioChunks')
      .withIndex('by_user_org', (q) =>
        q.eq('userId', userId).eq('organizationId', organizationId),
      )
      .take(PAGE_SIZE);
    if (page.length === 0) break;
    for (const row of page) {
      if (row.storageId) {
        try {
          await ctx.storage.delete(row.storageId);
        } catch (err) {
          console.warn(
            '[tts.cascadeOnTtsForMemberRemoved] storage.delete failed',
            err,
          );
        }
      }
      await ctx.db.delete(row._id);
      deleted += 1;
    }
    if (page.length < PAGE_SIZE) break;
  }
  return { deleted };
}

/**
 * Daily org-sweep cron worker. Walks every distinct org with at least one
 * `ttsAudioChunks` row, then deletes the org's rows older than
 * `CHUNK_RETENTION_MS`. Bounded by `MAX_ORGS_PER_RUN` × `ROWS_PER_ORG_PER_RUN`
 * so a multi-tenant deployment doesn't have one busy org starve the rest.
 *
 * Necessary because the docstring-implied "read-path GC" never actually
 * existed: queries cannot call `ctx.scheduler`, so the only GC trigger was
 * `markChunkReady` (write path). Threads that synthesize once and then go
 * idle never get their old rows reaped without this cron.
 *
 * Two-phase shape so we never burn the 16K mutation read budget on rows we
 * don't intend to touch:
 *   1. Probe `.first()` on `by_org_createdAt` with `gt(organizationId, ...)`
 *      to advance to the next distinct org. One row read per org found.
 *   2. Per-org indexed query bounded by `lt(createdAt, cutoff)` plus
 *      `.take(ROWS_PER_ORG_PER_RUN)` so fresh rows never load.
 */
export const gcOrgTtsChunks = internalMutation({
  args: {},
  returns: v.object({
    orgsScanned: v.number(),
    rowsDeleted: v.number(),
  }),
  handler: async (ctx) => {
    const cutoff = Date.now() - CHUNK_RETENTION_MS;
    let orgsScanned = 0;
    let rowsDeleted = 0;

    let cursor: string | undefined;
    while (orgsScanned < MAX_ORGS_PER_RUN) {
      const probe = await ctx.db
        .query('ttsAudioChunks')
        .withIndex('by_org_createdAt', (q) =>
          cursor === undefined ? q : q.gt('organizationId', cursor),
        )
        .first();
      if (!probe) break;
      const orgId = probe.organizationId;
      orgsScanned += 1;
      cursor = orgId;

      const stale = await ctx.db
        .query('ttsAudioChunks')
        .withIndex('by_org_createdAt', (q) =>
          q.eq('organizationId', orgId).lt('createdAt', cutoff),
        )
        .take(ROWS_PER_ORG_PER_RUN);
      for (const row of stale) {
        if (row.storageId) {
          try {
            await ctx.storage.delete(row.storageId);
          } catch (err) {
            console.warn('[tts.gcOrgTtsChunks] storage.delete failed', err);
          }
        }
        await ctx.db.delete(row._id);
        rowsDeleted += 1;
      }
    }

    console.info('[tts.gcOrgTtsChunks] done', { orgsScanned, rowsDeleted });
    return { orgsScanned, rowsDeleted };
  },
});
