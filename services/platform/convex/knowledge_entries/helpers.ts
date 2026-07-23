import type { MutationCtx } from '../_generated/server';

// Minimal stub of
// the retired `knowledge_entries/helpers.ts` — only
// `markEntryChainDeleted` is restored (the one export `documents/mutations.ts`
// uses, from its delete-document hook). The rest of the knowledge-entries
// domain (mutations.ts/queries.ts/internal_actions.ts that let users create
// and search entries, its `constants.ts`) was retired with the RAG
// rewrite and is NOT restored here.
//
// `knowledgeEntries` itself is still a live table (`knowledgeEntriesTable` in
// `convex/legacy/schema.ts`, kept so existing rows aren't orphaned by a schema
// change), and this soft-delete is pure DB hygiene with no RAG/AI dependency —
// it keeps working faithfully so deleting a document can't strand its linked
// knowledge-entry chain as stale "active" rows. No new entries can be created
// until the domain is rewritten, so in steady state this only ever finds rows
// created before the rewrite.

/**
 * Soft-delete every version row of the entry's topic chain. Used by
 * `deleteDocument` when the backing document is removed from the Documents
 * tab (so a tab delete can't orphan entries).
 */
export async function markEntryChainDeleted(
  ctx: MutationCtx,
  organizationId: string,
  topicKey: string,
): Promise<number> {
  const now = Date.now();
  let count = 0;
  for await (const row of ctx.db
    .query('knowledgeEntries')
    .withIndex('by_org_topicKey_status', (q) =>
      q.eq('organizationId', organizationId).eq('topicKey', topicKey),
    )) {
    if (row.deletedAt !== undefined) continue;
    await ctx.db.patch(row._id, { deletedAt: now });
    count++;
  }
  return count;
}
