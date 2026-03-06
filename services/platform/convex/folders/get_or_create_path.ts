import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export async function getOrCreateFolderPath(
  ctx: MutationCtx,
  organizationId: string,
  pathSegments: string[],
  createdBy?: string,
): Promise<Id<'folders'> | undefined> {
  if (pathSegments.length === 0) {
    return undefined;
  }

  let parentId: Id<'folders'> | undefined;

  for (const segment of pathSegments) {
    const existing = await ctx.db
      .query('folders')
      .withIndex('by_organizationId_and_parentId', (q) =>
        q.eq('organizationId', organizationId).eq('parentId', parentId),
      )
      .first();

    let found: Id<'folders'> | undefined;

    if (existing && existing.name === segment) {
      found = existing._id;
    } else {
      const q = ctx.db
        .query('folders')
        .withIndex('by_organizationId_and_parentId', (qb) =>
          qb.eq('organizationId', organizationId).eq('parentId', parentId),
        );

      for await (const folder of q) {
        if (folder.name === segment) {
          found = folder._id;
          break;
        }
      }
    }

    if (found) {
      parentId = found;
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
