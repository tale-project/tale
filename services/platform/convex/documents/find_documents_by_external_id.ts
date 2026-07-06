/**
 * All documents in an org that carry a given external item id.
 *
 * The singular {@link findDocumentByExternalId} returns only the first match —
 * enough for the id-keyed upsert, which expects at most one row per external
 * id. This plural variant collects every row sharing the id so the single-file
 * sync reconcile can find and collapse the duplicate rows a prior no-dedup sync
 * run created for the same source file. Indexed by
 * `by_organizationId_and_externalItemId`.
 *
 * Like the singular lookup, this intentionally does NOT filter on
 * lifecycleStatus — it backs sync-key reconcile, not a user read surface.
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export async function findDocumentsByExternalId(
  ctx: QueryCtx,
  args: { organizationId: string; externalItemId: string },
): Promise<Doc<'documents'>[]> {
  return ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_externalItemId', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('externalItemId', args.externalItemId),
    )
    .collect();
}
