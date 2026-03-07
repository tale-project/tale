import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export async function getOrCreateFolderPath(
  ctx: MutationCtx,
  organizationId: string,
  pathSegments: string[],
  createdBy?: string,
): Promise<Id<'folders'> | undefined> {
  const segments = pathSegments.filter((s) => s.trim().length > 0);
  if (segments.length === 0) {
    return undefined;
  }

  let parentId: Id<'folders'> | undefined;

  for (const segment of segments) {
    const existing = await ctx.db
      .query('folders')
      .withIndex('by_org_parent_name', (q) =>
        q
          .eq('organizationId', organizationId)
          .eq('parentId', parentId)
          .eq('name', segment),
      )
      .first();

    if (existing) {
      parentId = existing._id;
    } else {
      parentId = await ctx.db.insert('folders', {
        organizationId,
        name: segment,
        parentId,
        createdBy,
      });
    }
  }

  return parentId;
}
