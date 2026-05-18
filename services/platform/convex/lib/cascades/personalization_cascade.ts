import type { MutationCtx } from '../../_generated/server';
import { cascadeOnTtsForMemberRemoved } from '../../tts/cascade_helpers';

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

/**
 * Organization deleted: hard-delete all prefs + memories scoped to the org
 * across every user. Audit-log rows for the org are retained for the
 * configured audit retention window — do not call this hook to scrub
 * audits; that's a separate retention concern.
 */
export async function cascadeOnOrgDeleted(
  ctx: MutationCtx,
  organizationId: string,
): Promise<void> {
  const memories = await ctx.db
    .query('userMemories')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', organizationId),
    )
    .collect();
  await Promise.all(memories.map((m) => ctx.db.delete(m._id)));

  const prefs = await ctx.db
    .query('userPreferences')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', organizationId),
    )
    .collect();
  await Promise.all(prefs.map((p) => ctx.db.delete(p._id)));

  // TTS audio chunks (rows + `_storage` blobs) are org-scoped: a deleted org
  // must not leave verbatim assistant-voice renderings behind. Thread-cascade
  // catches chunks attached to live threads; this sweep covers orphaned
  // chunk rows (rare, from past partial failures).
  //
  // Paged via `.take(PAGE_SIZE)` instead of `.collect()`: the prior code
  // would silently truncate at Convex's 16K read limit, leaving a busy org
  // half-erased. The page-then-loop shape stays inside one mutation
  // transaction but bounds work per pass.
  const PAGE_SIZE = 200;
  // Cap at 30 pages (~6k rows) per cascade invocation to stay under
  // Convex's ~8K per-mutation write budget; whatever exceeds that gets
  // reaped by the hourly org-sweep cron within 7 days.
  for (let i = 0; i < 30; i++) {
    const page = await ctx.db
      .query('ttsAudioChunks')
      .withIndex('by_org_createdAt', (q) =>
        q.eq('organizationId', organizationId),
      )
      .take(PAGE_SIZE);
    if (page.length === 0) break;
    for (const chunk of page) {
      // db.delete BEFORE storage.delete — Convex `_storage` writes are
      // out-of-band and not rolled back on transaction abort. With the
      // previous order, a `db.delete` failure mid-iteration left the
      // row pointing at a deleted blob (404 on `/api/tts-audio`).
      // Matches the documented contract in `tts/cascade_helpers.ts:55-62`.
      const storageId = chunk.storageId;
      await ctx.db.delete(chunk._id);
      if (storageId) {
        try {
          await ctx.storage.delete(storageId);
        } catch (error) {
          console.warn(
            `[cascadeOnOrgDeleted] tts storage.delete failed for ${String(storageId)}:`,
            error,
          );
        }
      }
    }
    if (page.length < PAGE_SIZE) break;
  }
}
