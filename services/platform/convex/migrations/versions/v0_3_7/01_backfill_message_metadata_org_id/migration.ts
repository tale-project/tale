/**
 * Backfill messageMetadata.organizationId from thread
 *
 * `messageMetadata` gained an optional `organizationId` — the tenancy partition
 * the per-org admin chat-health rollup scopes and windows on (via the
 * `by_organizationId` index). Rows written before the field existed carry no
 * org, so `up` backfills each from its thread: look up `threadMetadata` by
 * `by_threadId` and copy its `organizationId`. Rows whose thread is missing
 * (deleted) or itself carries no org are LEFT unset — org-scoped rollups
 * exclude them anyway (an equality scan on `organizationId` never returns an
 * unset row), which is the intended, tenant-safe behaviour.
 *
 * `up` only reads (plus one patch) and skips already-stamped rows, so
 * `snapshot: 'none'` is sufficient: `down` fully reverses it by clearing
 * `organizationId` (a row that never had it is a no-op). Nothing is destroyed
 * in either direction, so the seeded world returns byte-for-byte on `down`.
 */

import type { Id } from '../../../../_generated/dataModel';
import type { MutationCtx } from '../../../../_generated/server';
import { defineDbMigration } from '../../../framework/define';

function getStr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Owning org of a thread, or null when the thread is gone / carries no org. */
async function orgForThread(
  ctx: MutationCtx,
  threadId: string,
): Promise<string | null> {
  // `.first()` (not `.unique()`): threadId is effectively unique in
  // threadMetadata, but a stray duplicate in historical data must not throw and
  // fail the whole backfill batch — any duplicate carries the same org.
  const thread = await ctx.db
    .query('threadMetadata')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .first();
  return getStr(thread?.organizationId) ?? null;
}

export const migration = defineDbMigration({
  title: 'Backfill messageMetadata.organizationId from thread',
  description:
    "Sets messageMetadata.organizationId from each row's thread " +
    '(threadMetadata.by_threadId) so per-org observability rollups scope and ' +
    'window at the index. Idempotent skip-if-set up; down clears organizationId.',
  destructive: false,
  snapshot: 'none',
  // `up` reads threadMetadata to derive the org and patches messageMetadata —
  // the corpus guard checks the chain world can exercise both.
  subjects: { tables: ['messageMetadata', 'threadMetadata'] },
  table: 'messageMetadata',

  // IDEMPOTENT per-row forward transform: a replayed, already-stamped row is a
  // no-op (the runner replays the crash batch on resume).
  async up(ctx, doc) {
    if (getStr(doc.organizationId)) return; // already stamped
    const threadId = getStr(doc.threadId);
    if (!threadId) return; // malformed row — nothing to resolve against

    const organizationId = await orgForThread(ctx, threadId);
    if (!organizationId) return; // thread missing or has no org → stay unset

    await ctx.db.patch(doc._id as Id<'messageMetadata'>, { organizationId });
  },

  // IDEMPOTENT inverse: clear the field `up` set. A row that never had an org
  // is a no-op, so `down` can walk every row unconditionally.
  async down(ctx, doc) {
    if (!getStr(doc.organizationId)) return;
    await ctx.db.patch(doc._id as Id<'messageMetadata'>, {
      organizationId: undefined,
    });
  },
});
