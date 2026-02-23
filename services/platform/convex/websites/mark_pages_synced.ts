import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export async function markPagesSynced(
  ctx: MutationCtx,
  pageIds: Id<'websitePages'>[],
): Promise<void> {
  await Promise.all(
    pageIds.map((id) => ctx.db.patch(id, { syncStatus: 'synced' as const })),
  );
}
