import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../../_generated/server';
import { cascadeOnTtsForMemberRemoved } from '../../legacy/tts_cascade';
import {
  deleteBlobInMutation,
  scheduleS3BlobDeletes,
} from '../storage/blob_delete';
import type { BlobRef } from '../storage/blob_ref';
import { pagedHardDelete } from './paged_delete';

/**
 * Active erasure cascades for the personalization tables. These run on
 * authoritative lifecycle events (member removal, org deletion) and
 * hard-delete the underlying rows immediately. They are the GDPR Art 17
 * erasure path; opportunistic lazy cleanup is for storage hygiene only
 * and is not on the erasure critical path.
 *
 * Audit-log rows are NOT deleted by these hooks — they retain the raw
 * `subjectUserId` for compliance reporting. Admin-blind pseudonymisation
 * can be reintroduced when an admin-readable audit view ships.
 *
 * NOTE: account-level deletion is not yet a product feature on this
 * deployment (Better Auth's user-delete plugin is not wired). When that
 * lands, add a `cascadeOnUserAccountDeleted` hook that fans out across
 * the user's orgs.
 */

async function deleteAllForUserOrg(
  ctx: MutationCtx,
  userId: string,
  organizationId: string,
): Promise<void> {
  const memories = await ctx.db
    .query('userMemories')
    .withIndex('by_user_org_status_deleted_created', (q) =>
      q.eq('userId', userId).eq('organizationId', organizationId),
    )
    .collect();
  await Promise.all(memories.map((m) => ctx.db.delete(m._id)));

  const prefs = await ctx.db
    .query('userPreferences')
    .withIndex('by_userId_organizationId', (q) =>
      q.eq('userId', userId).eq('organizationId', organizationId),
    )
    .collect();
  await Promise.all(prefs.map((p) => ctx.db.delete(p._id)));
}

/**
 * Member removed from an org: hard-delete that user's prefs + memories
 * scoped to the org, plus every TTS chunk they ever synthesized in this
 * org. The user keeps their data in any other org they're in.
 *
 * TTS chunks are PII (verbatim renderings of assistant replies the member
 * heard) so the per-user sweep is required for GDPR Art 17 compliance.
 * Pages via the `by_user_org` index introduced alongside this hook; legacy
 * rows lacking `userId` are reaped by the daily `gcOrgTtsChunks` cron.
 */
export async function cascadeOnMemberRemoved(
  ctx: MutationCtx,
  userId: string,
  organizationId: string,
): Promise<void> {
  await deleteAllForUserOrg(ctx, userId, organizationId);
  await cascadeOnTtsForMemberRemoved(ctx, userId, organizationId);
}

const STORAGE_PAGE_SIZE = 200;
// Storage-bearing tables: each row also triggers a sequential
// `ctx.storage.delete` round-trip. The binding limit here is the ~1s mutation
// execution-time budget, NOT the document-write budget (16K docs/mutation, and
// `_storage` deletes don't count as document writes). 15 × 200 = 3000 rows per
// pass keeps a single self-rescheduling pass comfortably within wall-clock
// budget; the drain reschedules to finish any remainder.
const STORAGE_DRAIN_MAX_PAGES = 15;

/**
 * One bounded pass deleting org-scoped rows that each own a `_storage` blob
 * (TTS chunks, videoLink jobs). Deletes the DB row BEFORE its blob — `_storage`
 * writes are out-of-band and not rolled back on a transaction abort, so
 * row-first guarantees a storage failure can never leave a row pointing at a
 * missing blob (and guarantees per-pass progress). Returns the count deleted
 * and whether the page budget was hit with a still-full page (more rows likely
 * remain → drain again), mirroring {@link pagedHardDelete}'s contract.
 */
async function drainOrgStorageRowsPage(
  ctx: MutationCtx,
  organizationId: string,
  takePage: (pageSize: number) => Promise<
    ReadonlyArray<{
      _id: Id<'ttsAudioChunks'> | Id<'videoLinkJobs'>;
      // Blob REFERENCE (`_storage` id or `s3:` ref) — both tables' storageId
      // fields are widened; an `s3:` ref routes through the scheduled node
      // delete lane below (a mutation can't sign S3).
      storageId?: BlobRef;
    }>
  >,
  label: string,
): Promise<{ deleted: number; exhausted: boolean }> {
  let deleted = 0;
  const s3Refs: string[] = [];
  const flush = () => scheduleS3BlobDeletes(ctx, organizationId, s3Refs);
  for (let page = 0; page < STORAGE_DRAIN_MAX_PAGES; page++) {
    const rows = await takePage(STORAGE_PAGE_SIZE);
    if (rows.length === 0) {
      await flush();
      return { deleted, exhausted: false };
    }
    for (const row of rows) {
      const storageId = row.storageId;
      await ctx.db.delete(row._id);
      deleted += 1;
      if (storageId) {
        await deleteBlobInMutation(ctx, storageId, s3Refs, label);
      }
    }
    if (rows.length < STORAGE_PAGE_SIZE) {
      await flush();
      return { deleted, exhausted: false };
    }
  }
  // Ran the full page budget with a still-full last page → assume more remain.
  await flush();
  return { deleted, exhausted: true };
}

// Per-table bounded drains, each returning the uniform `{ deleted, exhausted }`
// contract. Memories/preferences are pure row deletes (6000/pass via the shared
// pagedHardDelete default); TTS/videoLink also delete a `_storage` blob per row
// (3000/pass — see STORAGE_DRAIN_MAX_PAGES).
function drainOrgMemoriesPage(ctx: MutationCtx, organizationId: string) {
  return pagedHardDelete(ctx, (n) =>
    ctx.db
      .query('userMemories')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', organizationId),
      )
      .take(n),
  );
}

function drainOrgPrefsPage(ctx: MutationCtx, organizationId: string) {
  return pagedHardDelete(ctx, (n) =>
    ctx.db
      .query('userPreferences')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', organizationId),
      )
      .take(n),
  );
}

function drainOrgTtsChunksPage(ctx: MutationCtx, organizationId: string) {
  return drainOrgStorageRowsPage(
    ctx,
    organizationId,
    (n) =>
      ctx.db
        .query('ttsAudioChunks')
        .withIndex('by_org_createdAt', (q) =>
          q.eq('organizationId', organizationId),
        )
        .take(n),
    'cascadeOnOrgDeleted.tts',
  );
}

function drainOrgVideoLinkJobsPage(ctx: MutationCtx, organizationId: string) {
  return drainOrgStorageRowsPage(
    ctx,
    organizationId,
    (n) =>
      ctx.db
        .query('videoLinkJobs')
        .withIndex('by_organizationId_and_status', (q) =>
          q.eq('organizationId', organizationId),
        )
        .take(n),
    'cascadeOnOrgDeleted.videoLink',
  );
}

/**
 * Self-rescheduling drain for org-wide personalization erasure. Each invocation
 * deletes from AT MOST ONE non-empty table — memories → preferences → TTS audio
 * chunks → videoLink jobs, in priority order — so a single mutation never
 * issues more than one table's already-proven-safe per-pass volume.
 *
 * The prior implementation ran all four sweeps in ONE transaction, which could
 * cross the per-mutation budget on a large org, throw, commit nothing, and —
 * because the continuation was only scheduled on a clean return, not on a
 * throw — leave the org PERMANENTLY un-deletable: a GDPR Art 17 gap. There is
 * no cron backstop for memories/preferences, and none at all for videoLink
 * jobs, so the drain itself must guarantee completion.
 *
 * An empty table costs ~0 writes (a single read probe) and falls through to the
 * next; the first table that deletes anything stops the pass and reschedules a
 * fresh transaction with a fresh budget. When all four are empty the erasure is
 * complete and the drain stops. Termination holds because every productive pass
 * deletes ≥1 row and a pass that deletes nothing never reschedules.
 */
/**
 * One pass of the org personalization drain: delete from the first non-empty
 * table (in priority order) and, if anything was deleted, schedule a
 * continuation. Returns whether a continuation was scheduled (work remains).
 * Extracted from the {@link drainOrgPersonalizationErasure} handler so the
 * one-table-per-pass invariant and termination are unit-testable with a plain
 * `MutationCtx`.
 */
export async function drainOrgPersonalizationErasureOnce(
  ctx: MutationCtx,
  organizationId: string,
): Promise<{ rescheduled: boolean }> {
  const drains = [
    drainOrgMemoriesPage,
    drainOrgPrefsPage,
    drainOrgTtsChunksPage,
    drainOrgVideoLinkJobsPage,
  ];
  for (const drain of drains) {
    const { deleted } = await drain(ctx, organizationId);
    if (deleted > 0) {
      // Did real work this pass; more may remain (this table or a later one).
      // Continue in a fresh transaction with a fresh budget.
      await ctx.scheduler.runAfter(
        0,
        internal.lib.cascades.personalization_cascade
          .drainOrgPersonalizationErasure,
        { organizationId },
      );
      return { rescheduled: true };
    }
    // deleted === 0 → table already empty; fall through to the next table.
  }
  // All four tables empty → erasure complete.
  return { rescheduled: false };
}

export const drainOrgPersonalizationErasure = internalMutation({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await drainOrgPersonalizationErasureOnce(ctx, args.organizationId);
    return null;
  },
});

/**
 * Organization deleted: erase all personalization rows + blobs scoped to the
 * org (memories, preferences, TTS audio chunks, videoLink jobs) across every
 * user. Schedules the bounded {@link drainOrgPersonalizationErasure} drain
 * rather than deleting inline, so the caller's mutation (which also writes an
 * audit row and schedules filesystem cleanup) stays well within the
 * per-mutation budget regardless of org size. Scheduling from a mutation is
 * transactional — if the caller throws, no drain is scheduled — and the drain
 * runs after Better Auth removes the org row, which is safe: every table keys
 * on the `organizationId` string and none reads the org row.
 *
 * Audit-log rows for the org are retained for the configured audit retention
 * window — do not call this hook to scrub audits; that's a separate concern.
 */
export async function cascadeOnOrgDeleted(
  ctx: MutationCtx,
  organizationId: string,
): Promise<void> {
  await ctx.scheduler.runAfter(
    0,
    internal.lib.cascades.personalization_cascade
      .drainOrgPersonalizationErasure,
    { organizationId },
  );
}
