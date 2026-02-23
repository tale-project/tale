import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export interface DeletePagesArgs {
  websiteId: Id<'websites'>;
  pageIds: Id<'websitePages'>[];
}

export async function deletePages(
  ctx: MutationCtx,
  args: DeletePagesArgs,
): Promise<{ deleted: number }> {
  await Promise.all(args.pageIds.map((id) => ctx.db.delete(id)));

  if (args.pageIds.length > 0) {
    const website = await ctx.db.get(args.websiteId);
    if (website) {
      await ctx.db.patch(args.websiteId, {
        pageCount: Math.max(0, (website.pageCount ?? 0) - args.pageIds.length),
      });
    }
  }

  return { deleted: args.pageIds.length };
}
