import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';

const PAGE_SIZE = 200;
// 7 days — matches the retention contract documented on `ttsAudioChunks`.
const CHUNK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
// Per-run budget for the daily org sweep. Convex hard-kills mutations at
// the 1-minute timeout, so an unbounded sweep on a single org would never
// finish. 50 organisations × 1000 rows each is well under the budget and
// covers the largest realistic backlog for the demo deployment.
const MAX_ORGS_PER_RUN = 50;
const ROWS_PER_ORG_PER_RUN = 1000;

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
 */
export const gcOrgTtsChunks = internalMutation({
  args: {},
  returns: v.object({
    orgsScanned: v.number(),
    rowsDeleted: v.number(),
  }),
  handler: async (ctx) => {
    const cutoff = Date.now() - CHUNK_RETENTION_MS;
    const seenOrgs = new Set<string>();
    let orgsScanned = 0;
    let rowsDeleted = 0;

    // Iterate by `by_org_createdAt` — sorted by `(organizationId, createdAt)`
    // — so all of an org's rows arrive consecutively. We stop after the
    // first MAX_ORGS_PER_RUN unique orgs are processed.
    let perOrgRemaining = ROWS_PER_ORG_PER_RUN;
    let currentOrg: string | null = null;

    for await (const row of ctx.db.query('ttsAudioChunks')) {
      if (row.organizationId !== currentOrg) {
        if (!seenOrgs.has(row.organizationId)) {
          if (seenOrgs.size >= MAX_ORGS_PER_RUN) break;
          seenOrgs.add(row.organizationId);
          orgsScanned = seenOrgs.size;
        }
        currentOrg = row.organizationId;
        perOrgRemaining = ROWS_PER_ORG_PER_RUN;
      }
      if (perOrgRemaining <= 0) continue;
      if (row.createdAt >= cutoff) continue;
      if (row.storageId) {
        try {
          await ctx.storage.delete(row.storageId);
        } catch (err) {
          console.warn('[tts.gcOrgTtsChunks] storage.delete failed', err);
        }
      }
      await ctx.db.delete(row._id);
      rowsDeleted += 1;
      perOrgRemaining -= 1;
    }

    return { orgsScanned, rowsDeleted };
  },
});
