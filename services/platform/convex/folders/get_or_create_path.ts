import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import { validateFolderName } from './mutations';

export async function getOrCreateFolderPath(
  ctx: MutationCtx,
  organizationId: string,
  pathSegments: string[],
  createdBy?: string,
  teamId?: string,
): Promise<Id<'folders'> | undefined> {
  const segments = pathSegments.filter((s) => s.trim().length > 0);
  if (segments.length === 0) {
    return undefined;
  }

  let parentId: Id<'folders'> | undefined;

  for (const segment of segments) {
    let validName: string;
    try {
      validName = validateFolderName(segment);
    } catch {
      // Intentionally stop on invalid segments rather than throwing.
      // Callers (migration backfill, OneDrive import) rely on partial
      // path creation with their own error handling wrappers.
      break;
    }

    const existing = await ctx.db
      .query('folders')
      .withIndex('by_org_parent_name', (q) =>
        q
          .eq('organizationId', organizationId)
          .eq('parentId', parentId)
          .eq('name', validName),
      )
      .first();

    if (existing) {
      parentId = existing._id;
    } else {
      parentId = await ctx.db.insert('folders', {
        organizationId,
        name: validName,
        parentId,
        createdBy,
        teamId,
      });
    }
  }

  return parentId;
}
